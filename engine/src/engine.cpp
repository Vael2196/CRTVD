#include "crtvd/engine.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <numeric>
#include <stdexcept>
#include <string>
#include <utility>

namespace crtvd {
namespace {
using Vec = std::array<float, 3>;
struct Pixel {
    Vec rgb;
    float alpha;
};
using Rgb = std::array<std::uint8_t, 3>;

float linear(float s) {
    return s <= 0.04045F ? s / 12.92F : std::pow((s + 0.055F) / 1.055F, 2.4F);
}
float srgb(float x) {
    x = std::clamp(x, 0.0F, 1.0F);
    return x <= 0.0031308F ? 12.92F * x : 1.055F * std::pow(x, 1.0F / 2.4F) - 0.055F;
}
std::uint8_t byte(float x) {
    return static_cast<std::uint8_t>(std::lround(std::clamp(x, 0.0F, 1.0F) * 255.0F));
}
Rgb encode(const Vec &v) {
    return {byte(srgb(v[0])), byte(srgb(v[1])), byte(srgb(v[2]))};
}
Vec decode(const Rgb &v) {
    return {linear(v[0] / 255.0F), linear(v[1] / 255.0F), linear(v[2] / 255.0F)};
}

// Oklab, from Bjorn Ottosson's published linear-sRGB transform:
// https://bottosson.github.io/posts/oklab/ (MIT-licensed reference implementation).
Vec oklab(const Vec &c) {
    const float l = std::cbrt(0.4122214708F * c[0] + 0.5363325363F * c[1] + 0.0514459929F * c[2]);
    const float m = std::cbrt(0.2119034982F * c[0] + 0.6806995451F * c[1] + 0.1073969566F * c[2]);
    const float s = std::cbrt(0.0883024619F * c[0] + 0.2817188376F * c[1] + 0.6299787005F * c[2]);
    return {0.2104542553F * l + 0.7936177850F * m - 0.0040720468F * s,
            1.9779984951F * l - 2.4285922050F * m + 0.4505937099F * s,
            0.0259040371F * l + 0.7827717662F * m - 0.8086757660F * s};
}

std::size_t checked_pixels(int width, int height, std::size_t limit, const char *label) {
    if (width <= 0 || height <= 0 || width > max_dimension || height > max_dimension)
        throw std::invalid_argument(std::string(label) + " dimensions are out of range");
    const auto n = static_cast<std::size_t>(width) * static_cast<std::size_t>(height);
    if (n > limit)
        throw std::invalid_argument(std::string(label) + " pixel limit exceeded");
    return n;
}

std::vector<Pixel> resize(std::span<const std::uint8_t> input, int iw, int ih, const Options &o) {
    // Cache the 256 possible transfer-function results, not a float copy of the
    // entire source image. This keeps memory bounded for large uploads.
    std::array<float, 256> lut{};
    for (int i = 0; i < 256; ++i)
        lut[i] = linear(i / 255.0F);
    auto read = [&](int x, int y) {
        const auto i = (static_cast<std::size_t>(y) * iw + x) * 4;
        return Pixel{{lut[input[i]], lut[input[i + 1]], lut[input[i + 2]]}, input[i + 3] / 255.0F};
    };
    std::vector<Pixel> out(static_cast<std::size_t>(o.width) * o.height);
    const double sx = static_cast<double>(iw) / o.width;
    const double sy = static_cast<double>(ih) / o.height;
    for (int y = 0; y < o.height; ++y) {
        for (int x = 0; x < o.width; ++x) {
            auto &p = out[static_cast<std::size_t>(y) * o.width + x];
            if (o.resample == Resample::Nearest) {
                p = read(std::min(iw - 1, static_cast<int>((x + 0.5) * sx)),
                         std::min(ih - 1, static_cast<int>((y + 0.5) * sy)));
                continue;
            }
            // Exact rectangular coverage in linear light. Multiply colours by
            // alpha before averaging so invisible RGB cannot create dark halos.
            const double x0 = x * sx, x1 = std::min(static_cast<double>(iw), (x + 1) * sx);
            const double y0 = y * sy, y1 = std::min(static_cast<double>(ih), (y + 1) * sy);
            std::array<double, 3> sum{};
            double alpha = 0, weight = 0;
            for (int iy = static_cast<int>(y0); iy < std::min(ih, static_cast<int>(std::ceil(y1)));
                 ++iy) {
                const double wy = std::min(y1, static_cast<double>(iy + 1)) -
                                  std::max(y0, static_cast<double>(iy));
                for (int ix = static_cast<int>(x0);
                     ix < std::min(iw, static_cast<int>(std::ceil(x1))); ++ix) {
                    const double w = wy * (std::min(x1, static_cast<double>(ix + 1)) -
                                           std::max(x0, static_cast<double>(ix)));
                    const auto src = read(ix, iy);
                    weight += w;
                    alpha += src.alpha * w;
                    for (int c = 0; c < 3; ++c)
                        sum[c] += src.rgb[c] * src.alpha * w;
                }
            }
            p.alpha = weight > 0 ? static_cast<float>(alpha / weight) : 0;
            for (int c = 0; c < 3; ++c)
                p.rgb[c] = alpha > 0 ? static_cast<float>(sum[c] / alpha) : 0;
        }
    }
    return out;
}

struct Sample {
    Vec rgb;
    Vec lab;
    double weight;
};
struct Box {
    std::vector<Sample> samples;
    int axis = 0;
    double score = 0;
    void measure() {
        Vec lo{1e9F, 1e9F, 1e9F}, hi{-1e9F, -1e9F, -1e9F};
        double weight = 0;
        for (const auto &s : samples) {
            weight += s.weight;
            for (int c = 0; c < 3; ++c) {
                lo[c] = std::min(lo[c], s.lab[c]);
                hi[c] = std::max(hi[c], s.lab[c]);
            }
        }
        axis = 0;
        for (int c = 1; c < 3; ++c)
            if (hi[c] - lo[c] > hi[axis] - lo[axis])
                axis = c;
        score = samples.size() < 2 ? 0 : (hi[axis] - lo[axis]) * std::sqrt(weight);
    }
};

std::vector<Rgb> cut_palette(Box first, int count) {
    if (first.samples.empty())
        return {{{0, 0, 0}}};
    first.measure();
    std::vector<Box> boxes;
    boxes.push_back(std::move(first));
    while (static_cast<int>(boxes.size()) < count) {
        const auto best =
            std::max_element(boxes.begin(), boxes.end(),
                             [](const Box &a, const Box &b) { return a.score < b.score; });
        if (best == boxes.end() || best->score <= 0)
            break;
        auto values = std::move(best->samples);
        const int axis = best->axis;
        std::stable_sort(values.begin(), values.end(), [axis](const Sample &a, const Sample &b) {
            return a.lab[axis] < b.lab[axis];
        });
        double total = 0;
        for (const auto &s : values)
            total += s.weight;
        double partial = 0;
        std::size_t cut = 0;
        while (cut + 1 < values.size() && partial < total * 0.5)
            partial += values[cut++].weight;
        cut = std::clamp<std::size_t>(cut, 1, values.size() - 1);
        Box left, right;
        left.samples.assign(values.begin(), values.begin() + static_cast<std::ptrdiff_t>(cut));
        right.samples.assign(values.begin() + static_cast<std::ptrdiff_t>(cut), values.end());
        left.measure();
        right.measure();
        *best = std::move(left);
        boxes.push_back(std::move(right));
    }
    std::vector<Rgb> palette;
    for (const auto &b : boxes) {
        std::array<double, 3> sum{};
        double total = 0;
        for (const auto &s : b.samples) {
            total += s.weight;
            for (int c = 0; c < 3; ++c)
                sum[c] += s.rgb[c] * s.weight;
        }
        Vec rgb{};
        for (int c = 0; c < 3; ++c)
            rgb[c] = static_cast<float>(sum[c] / total);
        palette.push_back(encode(rgb));
    }
    std::sort(palette.begin(), palette.end(), [](const Rgb &a, const Rgb &b) {
        const float la = oklab(decode(a))[0], lb = oklab(decode(b))[0];
        return la != lb ? la < lb : a < b;
    });
    palette.erase(std::unique(palette.begin(), palette.end()), palette.end());
    return palette;
}
std::vector<Rgb> adaptive(const std::vector<Pixel> &pixels, int count) {
    struct Bin {
        std::array<double, 3> sum{};
        double weight = 0;
    };
    std::vector<Bin> bins(32 * 32 * 32);
    // Deterministic stratified sampling caps palette construction cost. Alpha
    // weights each contribution; fully invisible pixels never affect palettes.
    const auto samples = std::min<std::size_t>(pixels.size(), 65'536);
    for (std::size_t i = 0; i < samples; ++i) {
        const auto &p = pixels[i * pixels.size() / samples];
        if (p.alpha <= 0)
            continue;
        const auto rgb = encode(p.rgb);
        auto &b = bins[(rgb[0] >> 3) * 1024 + (rgb[1] >> 3) * 32 + (rgb[2] >> 3)];
        b.weight += p.alpha;
        for (int c = 0; c < 3; ++c)
            b.sum[c] += p.rgb[c] * p.alpha;
    }
    Box first;
    for (const auto &b : bins)
        if (b.weight > 0) {
            Vec rgb{};
            for (int c = 0; c < 3; ++c)
                rgb[c] = static_cast<float>(b.sum[c] / b.weight);
            first.samples.push_back({rgb, oklab(rgb), b.weight});
        }
    return cut_palette(std::move(first), count);
}

std::vector<Rgb> make_palette(const std::vector<Pixel> &pixels, const Options &o) {
    switch (o.palette) {
    case PaletteMode::Adaptive:
        return adaptive(pixels, o.colours);
    case PaletteMode::Monochrome:
        return {{{0, 0, 0}}, {{255, 255, 255}}};
    case PaletteMode::Handheld:
        return {{{15, 56, 15}}, {{48, 98, 48}}, {{139, 172, 15}}, {{155, 188, 15}}};
    case PaletteMode::Cga:
        return {{{0, 0, 0}}, {{85, 255, 255}}, {{255, 85, 255}}, {{255, 255, 255}}};
    }
    throw std::invalid_argument("Unknown palette");
}

} // namespace

Result process(std::span<const std::uint8_t> input, int iw, int ih, const Options &o,
               std::span<const std::uint8_t> palette_override) {
    const auto n = checked_pixels(iw, ih, max_input_pixels, "Input");
    const auto out_n = checked_pixels(o.width, o.height, max_output_pixels, "Output");
    if (input.size() != n * 4)
        throw std::invalid_argument("RGBA buffer size does not match input dimensions");
    if (o.width > iw || o.height > ih)
        throw std::invalid_argument("Output dimensions must not exceed the input");
    if (o.colours < 2 || o.colours > 256)
        throw std::invalid_argument("Palette size must be between 2 and 256");
    if (!std::isfinite(o.strength) || o.strength < 0 || o.strength > 1)
        throw std::invalid_argument("Dither strength must be between 0 and 1");
    if (o.dither < Dither::None || o.dither > Dither::FloydSteinberg)
        throw std::invalid_argument("Unknown dithering method");
    if (o.resample < Resample::Area || o.resample > Resample::Nearest)
        throw std::invalid_argument("Unknown resampling method");
    if (o.palette < PaletteMode::Adaptive || o.palette > PaletteMode::Cga)
        throw std::invalid_argument("Unknown palette");
    if (!palette_override.empty() && (palette_override.size() % 3 || palette_override.size() > 768))
        throw std::invalid_argument("Custom palette must contain 1 to 256 RGB triplets");
    auto pixels = resize(input, iw, ih, o);
    std::vector<Rgb> palette;
    if (palette_override.empty())
        palette = make_palette(pixels, o);
    else
        for (std::size_t i = 0; i < palette_override.size(); i += 3)
            palette.push_back(
                {palette_override[i], palette_override[i + 1], palette_override[i + 2]});
    std::vector<Vec> labs, rgb;
    for (const auto &p : palette) {
        rgb.push_back(decode(p));
        labs.push_back(oklab(rgb.back()));
    }
    Result result{o.width, o.height, std::vector<std::uint8_t>(out_n * 4), {}};
    for (const auto &c : palette)
        result.palette.insert(result.palette.end(), c.begin(), c.end());
    std::vector<Vec> current(static_cast<std::size_t>(o.width) + 2), next(current.size());
    constexpr int bayer[16] = {0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5};
    const float ordered_scale = 0.4F / std::cbrt(static_cast<float>(palette.size()));
    for (int y = 0; y < o.height; ++y) {
        const bool reverse = o.dither == Dither::FloydSteinberg && (y % 2 == 1);
        const int direction = reverse ? -1 : 1;
        for (int k = 0; k < o.width; ++k) {
            const int x = reverse ? o.width - 1 - k : k;
            const auto index = static_cast<std::size_t>(y) * o.width + x;
            const auto &p = pixels[index];
            auto *dest = result.rgba.data() + index * 4;
            dest[3] = byte(p.alpha);
            if (dest[3] == 0)
                continue;
            Vec adjusted = p.rgb;
            if (o.dither == Dither::FloydSteinberg)
                for (int c = 0; c < 3; ++c)
                    adjusted[c] = std::clamp(adjusted[c] + current[x + 1][c], 0.0F, 1.0F);
            Vec lab = oklab(adjusted);
            if (o.dither == Dither::Bayer4)
                lab[0] += ((bayer[(y % 4) * 4 + x % 4] + 0.5F) / 16.0F - 0.5F) * ordered_scale *
                          o.strength;
            std::size_t chosen = 0;
            float best = std::numeric_limits<float>::max();
            for (std::size_t j = 0; j < labs.size(); ++j) {
                float distance = 0;
                for (int c = 0; c < 3; ++c)
                    distance += (lab[c] - labs[j][c]) * (lab[c] - labs[j][c]);
                if (distance < best) {
                    best = distance;
                    chosen = j;
                }
            }
            std::copy(palette[chosen].begin(), palette[chosen].end(), dest);
            if (o.dither == Dither::FloydSteinberg) {
                // Serpentine diffusion; don't carry invisible colour errors
                // across transparent boundaries. Edge weights aren't renormalised.
                const auto spread = [&](int nx, int ny, float weight, std::vector<Vec> &row) {
                    if (nx < 0 || nx >= o.width || ny >= o.height)
                        return;
                    const auto &neighbour = pixels[static_cast<std::size_t>(ny) * o.width + nx];
                    if (neighbour.alpha <= 0)
                        return;
                    for (int c = 0; c < 3; ++c)
                        row[nx + 1][c] +=
                            (adjusted[c] - rgb[chosen][c]) * weight * o.strength * p.alpha;
                };
                spread(x + direction, y, 7.0F / 16, current);
                spread(x - direction, y + 1, 3.0F / 16, next);
                spread(x, y + 1, 5.0F / 16, next);
                spread(x + direction, y + 1, 1.0F / 16, next);
            }
        }
        current.swap(next);
        std::fill(next.begin(), next.end(), Vec{});
    }
    return result;
}
PaletteTrainer::PaletteTrainer() : histogram_(32 * 32 * 32) {}

void PaletteTrainer::add_frame(std::span<const std::uint8_t> input, int iw, int ih,
                               const Options &o, double seconds) {
    const auto n = checked_pixels(iw, ih, max_input_pixels, "Input");
    checked_pixels(o.width, o.height, max_output_pixels, "Output");
    if (input.size() != n * 4 || o.width > iw || o.height > ih)
        throw std::invalid_argument("Invalid palette-training frame dimensions or buffer");
    if (o.resample < Resample::Area || o.resample > Resample::Nearest)
        throw std::invalid_argument("Unknown resampling method");
    if (!std::isfinite(seconds) || seconds <= 0 || seconds > 30)
        throw std::invalid_argument(
            "Frame duration must be finite, positive and at most 30 seconds");
    const auto pixels = resize(input, iw, ih, o);
    const auto samples = std::min<std::size_t>(pixels.size(), 4096);
    for (std::size_t i = 0; i < samples; ++i) {
        const auto &p = pixels[i * pixels.size() / samples];
        if (p.alpha <= 0)
            continue;
        const auto rgb = encode(p.rgb);
        auto &bin = histogram_[(rgb[0] >> 3) * 1024 + (rgb[1] >> 3) * 32 + (rgb[2] >> 3)];
        const double weight = p.alpha * seconds / static_cast<double>(samples);
        for (int c = 0; c < 3; ++c)
            bin[c] += p.rgb[c] * weight;
        bin[3] += weight;
    }
}

std::vector<std::uint8_t> PaletteTrainer::finish(int colours) const {
    if (colours < 2 || colours > 256)
        throw std::invalid_argument("Palette size must be between 2 and 256");
    Box first;
    for (const auto &bin : histogram_)
        if (bin[3] > 0) {
            Vec rgb{};
            for (int c = 0; c < 3; ++c)
                rgb[c] = static_cast<float>(bin[c] / bin[3]);
            first.samples.push_back({rgb, oklab(rgb), bin[3]});
        }
    std::vector<std::uint8_t> output;
    for (const auto &rgb : cut_palette(std::move(first), colours))
        output.insert(output.end(), rgb.begin(), rgb.end());
    return output;
}

} // namespace crtvd
