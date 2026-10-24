#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <span>
#include <vector>

namespace crtvd {

// These integer values also form the public Wasm API. Keep them stable.
enum class PaletteMode : int { Adaptive = 0, Monochrome = 1, Handheld = 2, Cga = 3 };
enum class Dither : int { None = 0, Bayer4 = 1, FloydSteinberg = 2 };
enum class Resample : int { Area = 0, Nearest = 1 };

struct Options {
    int width = 160;
    int height = 120;
    PaletteMode palette = PaletteMode::Adaptive;
    int colours = 16;
    Dither dither = Dither::Bayer4;
    float strength = 0.65F;
    Resample resample = Resample::Area;
};

struct Result {
    int width;
    int height;
    std::vector<std::uint8_t> rgba;
    // Packed RGB triplets. Transparency is preserved separately in rgba.
    std::vector<std::uint8_t> palette;
};

inline constexpr std::size_t max_input_pixels = 16'777'216;
inline constexpr std::size_t max_output_pixels = 1'048'576;
inline constexpr int max_dimension = 16'384;

// Input and output use straight-alpha, sRGB RGBA8. Processing itself is
// independent of browsers, codecs, file paths, and UI frameworks.
Result process(std::span<const std::uint8_t> rgba, int width, int height, const Options &options,
               std::span<const std::uint8_t> palette_override = {});

// A bounded histogram shared across a clip. Each frame contributes according
// to its display duration; finish() produces one palette for all frames.
class PaletteTrainer {
  public:
    PaletteTrainer();
    void add_frame(std::span<const std::uint8_t> rgba, int width, int height,
                   const Options &options, double seconds);
    std::vector<std::uint8_t> finish(int colours) const;

  private:
    // Per bin: accumulated linear R, G, B and population weight (~1 MiB).
    std::vector<std::array<double, 4>> histogram_;
};

} // namespace crtvd
