#pragma once
#include <cstdint>
#include <filesystem>
#include <vector>
namespace crtvd::io {
struct Image {
    int width;
    int height;
    std::vector<std::uint8_t> rgba;
};
Image read(const std::filesystem::path &path);
void write_png(const std::filesystem::path &path, int width, int height,
               const std::vector<std::uint8_t> &rgba, bool overwrite);
} // namespace crtvd::io
