#include "crtvd/engine.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <functional>
#include <iostream>
#include <limits>
#include <set>
#include <stdexcept>
#include <string>

extern "C" {
crtvd::Result *crtvd_process(const std::uint8_t *, std::size_t, int, int, int, int, int, int, int,
                             float, int) noexcept;
const char *crtvd_last_error() noexcept;
void crtvd_result_free(crtvd::Result *) noexcept;
}

namespace {
void check(bool condition, const std::string &message) {
    if (!condition)
        throw std::runtime_error(message);
}
void rejects(const std::function<void()> &f) {
    bool thrown = false;
    try {
        f();
    } catch (const std::invalid_argument &) {
        thrown = true;
    }
    check(thrown, "Expected invalid_argument");
}
std::vector<std::uint8_t> gradient(int width, int height) {
    std::vector<std::uint8_t> image(static_cast<std::size_t>(width) * height * 4);
    for (int y = 0; y < height; ++y)
        for (int x = 0; x < width; ++x) {
            const auto i = (static_cast<std::size_t>(y) * width + x) * 4;
            image[i] = static_cast<std::uint8_t>(255 * x / std::max(1, width - 1));
            image[i + 1] = static_cast<std::uint8_t>(255 * y / std::max(1, height - 1));
            image[i + 2] = static_cast<std::uint8_t>((x * 17 + y * 13) % 256);
            image[i + 3] = 255;
        }
    return image;
}
void palette_only(const crtvd::Result &result) {
    std::set<std::array<std::uint8_t, 3>> allowed;
    for (std::size_t i = 0; i < result.palette.size(); i += 3)
        allowed.insert({result.palette[i], result.palette[i + 1], result.palette[i + 2]});
    for (std::size_t i = 0; i < result.rgba.size(); i += 4)
        if (result.rgba[i + 3])
            check(allowed.contains({result.rgba[i], result.rgba[i + 1], result.rgba[i + 2]}),
                  "Pixel outside palette");
}
} // namespace

int main() {
    int passed = 0, failed = 0;
    auto test = [&](const char *name, const std::function<void()> &f) {
        try {
            f();
            ++passed;
            std::cout << "PASS " << name << '\n';
        } catch (const std::exception &e) {
            ++failed;
            std::cerr << "FAIL " << name << ": " << e.what() << '\n';
        }
    };
    test("solid colour survives adaptive quantisation", [] {
        const std::vector<std::uint8_t> image{200, 40, 70, 255, 200, 40, 70, 255};
        crtvd::Options o;
        o.width = 1;
        o.height = 1;
        o.dither = crtvd::Dither::None;
        const auto r = crtvd::process(image, 2, 1, o);
        check(r.rgba == std::vector<std::uint8_t>({200, 40, 70, 255}), "Solid changed");
        check(r.palette.size() == 3, "Redundant palette entries");
    });
    test("area filter averages light rather than encoded sRGB", [] {
        const std::vector<std::uint8_t> image{0, 0, 0, 255, 255, 255, 255, 255};
        crtvd::Options o;
        o.width = 1;
        o.height = 1;
        o.dither = crtvd::Dither::None;
        const auto r = crtvd::process(image, 2, 1, o);
        check(std::abs(static_cast<int>(r.rgba[0]) - 188) <= 1,
              "Linear-light average should be about 188, not 128");
    });
    test("non-integer area coverage is weighted correctly", [] {
        const std::vector<std::uint8_t> image{0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255};
        crtvd::Options o;
        o.width = 2;
        o.height = 1;
        o.dither = crtvd::Dither::None;
        const auto r = crtvd::process(image, 3, 1, o);
        check(r.rgba[0] == 0 && std::abs(static_cast<int>(r.rgba[4]) - 213) <= 1,
              "Incorrect fractional coverage");
    });
    test("nearest neighbour samples source pixel centres", [] {
        const std::vector<std::uint8_t> image{0, 0, 0, 255, 255, 255, 255, 255};
        crtvd::Options o;
        o.width = 1;
        o.height = 1;
        o.resample = crtvd::Resample::Nearest;
        o.dither = crtvd::Dither::None;
        const auto r = crtvd::process(image, 2, 1, o);
        check(r.rgba[0] == 255, "Wrong nearest pixel");
    });
    test("transparent source colours do not contaminate edges", [] {
        const std::vector<std::uint8_t> image{255, 0, 0, 255, 0, 0, 255, 0};
        crtvd::Options o;
        o.width = 1;
        o.height = 1;
        o.dither = crtvd::Dither::None;
        const auto r = crtvd::process(image, 2, 1, o);
        check(r.rgba == std::vector<std::uint8_t>({255, 0, 0, 128}),
              "Premultiplied filtering failed");
    });
    test("fully transparent input is canonical transparent black", [] {
        const std::vector<std::uint8_t> image{255, 40, 20, 0, 10, 90, 255, 0};
        crtvd::Options o;
        o.width = 2;
        o.height = 1;
        const auto r = crtvd::process(image, 2, 1, o);
        check(std::all_of(r.rgba.begin(), r.rgba.end(), [](auto x) { return x == 0; }),
              "Invisible RGB leaked");
        check(r.palette.size() == 3, "Empty palette fallback missing");
    });
    test("all palettes and dithers obey colour limits", [] {
        const auto image = gradient(73, 47);
        for (int palette = 0; palette < 4; ++palette)
            for (int dither = 0; dither < 3; ++dither) {
                crtvd::Options o;
                o.width = 39;
                o.height = 25;
                o.colours = 8;
                o.palette = static_cast<crtvd::PaletteMode>(palette);
                o.dither = static_cast<crtvd::Dither>(dither);
                const auto r = crtvd::process(image, 73, 47, o);
                palette_only(r);
                check(r.rgba.size() == 39 * 25 * 4, "Wrong dimensions");
                const std::size_t expected = palette == 0 ? 8 : palette == 1 ? 2 : 4;
                check(r.palette.size() / 3 <= expected, "Too many colours");
            }
    });
    test("palette size sweep and deterministic output", [] {
        const auto image = gradient(31, 29);
        for (int count : {2, 4, 16, 64, 256}) {
            crtvd::Options o;
            o.width = 31;
            o.height = 29;
            o.colours = count;
            o.dither = crtvd::Dither::FloydSteinberg;
            const auto a = crtvd::process(image, 31, 29, o), b = crtvd::process(image, 31, 29, o);
            check(a.palette == b.palette && a.rgba == b.rgba, "Non-deterministic result");
            check(a.palette.size() / 3 <= static_cast<std::size_t>(count), "Palette cap exceeded");
            palette_only(a);
        }
    });
    test("zero-strength dithering matches no dithering", [] {
        const auto image = gradient(32, 24);
        crtvd::Options o;
        o.width = 32;
        o.height = 24;
        o.dither = crtvd::Dither::None;
        const auto reference = crtvd::process(image, 32, 24, o);
        o.strength = 0;
        for (auto d : {crtvd::Dither::Bayer4, crtvd::Dither::FloydSteinberg}) {
            o.dither = d;
            check(crtvd::process(image, 32, 24, o).rgba == reference.rgba,
                  "Zero strength changed output");
        }
    });
    test("both dithers create intermediate tone coverage", [] {
        std::vector<std::uint8_t> image(32 * 32 * 4, 128);
        for (std::size_t i = 3; i < image.size(); i += 4)
            image[i] = 255;
        crtvd::Options o;
        o.width = 32;
        o.height = 32;
        o.palette = crtvd::PaletteMode::Monochrome;
        o.strength = 1;
        for (auto d : {crtvd::Dither::Bayer4, crtvd::Dither::FloydSteinberg}) {
            o.dither = d;
            const auto r = crtvd::process(image, 32, 32, o);
            int black = 0, white = 0;
            for (std::size_t i = 0; i < r.rgba.size(); i += 4) {
                black += r.rgba[i] == 0;
                white += r.rgba[i] == 255;
            }
            check(black > 0 && white > 0, "Dither did not mix black and white");
        }
    });
    test("one-pixel-wide and one-pixel-tall diffusion boundaries", [] {
        for (const auto &[w, h] : {std::pair{1, 19}, std::pair{19, 1}, std::pair{1, 1}}) {
            crtvd::Options o;
            o.width = w;
            o.height = h;
            o.dither = crtvd::Dither::FloydSteinberg;
            const auto r = crtvd::process(gradient(w, h), w, h, o);
            palette_only(r);
        }
    });
    test("transparency survives all dither modes", [] {
        auto image = gradient(16, 8);
        for (std::size_t i = 0; i < image.size(); i += 4)
            image[i + 3] = static_cast<std::uint8_t>((i / 4) % 256);
        crtvd::Options o;
        o.width = 16;
        o.height = 8;
        for (auto d : {crtvd::Dither::None, crtvd::Dither::Bayer4, crtvd::Dither::FloydSteinberg}) {
            o.dither = d;
            const auto r = crtvd::process(image, 16, 8, o);
            for (std::size_t i = 3; i < image.size(); i += 4)
                check(r.rgba[i] == image[i], "Alpha changed");
        }
    });
    test("invalid buffers, sizes, options and non-finite values rejected", [] {
        const auto image = gradient(2, 2);
        crtvd::Options o;
        o.width = 1;
        o.height = 1;
        rejects([&] { crtvd::process(image, 0, 2, o); });
        rejects([&] { crtvd::process(image, 2, 3, o); });
        rejects([&] { crtvd::process(image, 16385, 1, o); });
        rejects([&] { crtvd::process(image, 4097, 4097, o); });
        o.width = 3;
        rejects([&] { crtvd::process(image, 2, 2, o); });
        o.width = 1;
        o.width = 1025;
        o.height = 1025;
        rejects([&] { crtvd::process(image, 2, 2, o); });
        o.width = 1;
        o.height = 1;
        o.colours = 257;
        rejects([&] { crtvd::process(image, 2, 2, o); });
        o.colours = 16;
        o.strength = std::numeric_limits<float>::quiet_NaN();
        rejects([&] { crtvd::process(image, 2, 2, o); });
        o.strength = -.1F;
        rejects([&] { crtvd::process(image, 2, 2, o); });
        o.strength = .5F;
        o.palette = static_cast<crtvd::PaletteMode>(999);
        rejects([&] { crtvd::process(image, 2, 2, o); });
        o.palette = crtvd::PaletteMode::Adaptive;
        o.dither = static_cast<crtvd::Dither>(999);
        rejects([&] { crtvd::process(image, 2, 2, o); });
        o.dither = crtvd::Dither::None;
        o.resample = static_cast<crtvd::Resample>(999);
        rejects([&] { crtvd::process(image, 2, 2, o); });
    });
    test("C boundary returns errors and recovers on the next call", [] {
        check(!crtvd_process(nullptr, 0, 1, 1, 1, 1, 0, 16, 0, 1, 0), "Null accepted");
        check(std::string(crtvd_last_error()).find("null") != std::string::npos, "Error missing");
        const std::uint8_t pixel[4] = {12, 34, 56, 255};
        auto *r = crtvd_process(pixel, 4, 1, 1, 1, 1, 0, 16, 0, 1, 0);
        check(r != nullptr, "Recovery failed");
        check(crtvd_last_error()[0] == '\0', "Stale error");
        crtvd_result_free(r);
        crtvd_result_free(nullptr);
    });
    test("clip palette training keeps one reusable palette across frames", [] {
        const std::vector<std::uint8_t> red{255, 0, 0, 255}, blue{0, 0, 255, 255};
        crtvd::Options o;
        o.width = 1;
        o.height = 1;
        o.dither = crtvd::Dither::None;
        crtvd::PaletteTrainer trainer;
        trainer.add_frame(red, 1, 1, o, .1);
        trainer.add_frame(blue, 1, 1, o, .2);
        const auto palette = trainer.finish(2);
        check(palette.size() == 6, "Palette should contain both frame colours");
        const auto a = crtvd::process(red, 1, 1, o, palette),
                   b = crtvd::process(blue, 1, 1, o, palette);
        check(a.palette == b.palette && a.rgba == red && b.rgba == blue,
              "Shared palette changed frame colours");
        check(trainer.finish(2) == palette, "Training result isn't deterministic");
    });
    test("clip palette weights colours by display duration", [] {
        const std::vector<std::uint8_t> a{100, 0, 0, 255}, b{102, 0, 0, 255};
        crtvd::Options o;
        o.width = 1;
        o.height = 1;
        crtvd::PaletteTrainer trainer;
        trainer.add_frame(a, 1, 1, o, .1);
        trainer.add_frame(b, 1, 1, o, .9);
        check(trainer.finish(2) == std::vector<std::uint8_t>({102, 0, 0}),
              "Duration weighting was lost");
    });
    test("custom palettes and training inputs are validated", [] {
        crtvd::Options o;
        o.width = 1;
        o.height = 1;
        const std::vector<std::uint8_t> pixel{10, 20, 30, 255}, invalid{1, 2};
        rejects([&] { crtvd::process(pixel, 1, 1, o, invalid); });
        crtvd::PaletteTrainer trainer;
        rejects([&] { trainer.add_frame(pixel, 1, 1, o, 0); });
        rejects(
            [&] { trainer.add_frame(pixel, 1, 1, o, std::numeric_limits<double>::infinity()); });
        rejects([&] { trainer.finish(257); });
        check(trainer.finish(2) == std::vector<std::uint8_t>({0, 0, 0}),
              "Empty training fallback failed");
    });
    std::cout << passed << " passed, " << failed << " failed\n";
    return failed ? 1 : 0;
}
