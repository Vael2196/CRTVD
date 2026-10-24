#include "image_io.hpp"
#include "crtvd/engine.hpp"
#include <algorithm>
#include <array>
#include <chrono>
#include <cstring>
#include <fstream>
#include <memory>
#include <stdexcept>

#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_PNG
#define STBI_ONLY_JPEG
#define STBI_MAX_DIMENSIONS 16384
#include <stb_image.h>
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include <stb_image_write.h>

namespace crtvd::io {
Image read(const std::filesystem::path &path) {
    std::ifstream file(path, std::ios::binary);
    std::array<unsigned char, 8> magic{};
    file.read(reinterpret_cast<char *>(magic.data()), magic.size());
    if (!file || (std::memcmp(magic.data(), "\x89PNG\r\n\x1a\n", 8) != 0 &&
                  !(magic[0] == 0xff && magic[1] == 0xd8)))
        throw std::runtime_error("Input must be a readable PNG or JPEG still image");
    int width = 0, height = 0, channels = 0;
    if (!stbi_info(path.string().c_str(), &width, &height, &channels))
        throw std::runtime_error("Cannot read image header");
    if (width < 1 || height < 1 || width > max_dimension || height > max_dimension ||
        static_cast<std::size_t>(width) * height > max_input_pixels)
        throw std::runtime_error("Input dimensions exceed engine limits");
    std::unique_ptr<stbi_uc, decltype(&stbi_image_free)> pixels(
        stbi_load(path.string().c_str(), &width, &height, &channels, 4), stbi_image_free);
    if (!pixels)
        throw std::runtime_error(std::string("Image decoding failed: ") + stbi_failure_reason());
    const auto length = static_cast<std::size_t>(width) * height * 4;
    return {width, height, std::vector<std::uint8_t>(pixels.get(), pixels.get() + length)};
}
void write_png(const std::filesystem::path &path, int width, int height,
               const std::vector<std::uint8_t> &rgba, bool overwrite) {
    if (std::filesystem::exists(path) && !overwrite)
        throw std::runtime_error("Output exists; use --force to replace it");
    if (rgba.size() != static_cast<std::size_t>(width) * height * 4)
        throw std::runtime_error("Invalid output buffer");
    auto temporary = path;
    temporary += ".crtvd-" +
                 std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) +
                 ".tmp";
    try {
        if (!stbi_write_png(temporary.string().c_str(), width, height, 4, rgba.data(), width * 4))
            throw std::runtime_error("Cannot write output PNG");
        std::filesystem::rename(temporary, path);
    } catch (...) {
        std::error_code ec;
        std::filesystem::remove(temporary, ec);
        throw;
    }
}
} // namespace crtvd::io
