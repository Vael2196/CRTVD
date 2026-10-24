#include "crtvd/engine.hpp"
#include "image_io.hpp"
#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>

namespace {
const char *help = R"(CRT Visual Downscaler 0.3.0
Usage: crtvd INPUT.png|jpg OUTPUT.png [options]

  --width N              Output width (default min(160, input width))
  --height N             Optional height; otherwise preserve aspect ratio
  --colours N            Adaptive palette size, 2..256 (default 16)
  --palette MODE         adaptive | monochrome | handheld | cga
  --dither MODE          none | bayer | floyd (default bayer)
  --strength NUMBER      Dither strength 0..1 (default 0.65)
  --resample MODE        area | nearest (default area)
  --palette-in FILE.hex  Custom palette: one #RRGGBB colour per line
  --palette-out FILE.hex Write the selected RGB palette
  --report FILE.json     Write dimensions, RGB palette and engine timing
  --force                Replace existing output files
  --help                 Print this help
  --version              Print the release version

Native CLI inputs are PNG/JPEG still images; output is RGBA PNG.
Use the web editor for GIF/video conversion. JPEG EXIF orientation and ICC/HDR
colour management are not interpreted by this native release.
)";
int number(const std::string &text) {
    std::size_t end = 0;
    int value = std::stoi(text, &end);
    if (end != text.size())
        throw std::invalid_argument("Expected an integer: " + text);
    return value;
}
float decimal(const std::string &text) {
    std::size_t end = 0;
    float value = std::stof(text, &end);
    if (end != text.size() || !std::isfinite(value))
        throw std::invalid_argument("Expected a finite number: " + text);
    return value;
}
std::vector<std::uint8_t> read_palette(const std::string &name) {
    std::ifstream file(name);
    if (!file)
        throw std::runtime_error("Cannot open palette file");
    std::vector<std::uint8_t> colours;
    std::string line;
    while (std::getline(file, line)) {
        line.erase(std::remove_if(line.begin(), line.end(),
                                  [](unsigned char c) { return std::isspace(c); }),
                   line.end());
        if (line.empty() || line.starts_with(';') || line.starts_with("//"))
            continue;
        if (line.starts_with('#'))
            line.erase(0, 1);
        if (line.size() != 6 ||
            line.find_first_not_of("0123456789abcdefABCDEF") != std::string::npos)
            throw std::invalid_argument("Palette lines must be #RRGGBB");
        for (int c = 0; c < 3; c++)
            colours.push_back(
                static_cast<std::uint8_t>(std::stoi(line.substr(c * 2, 2), nullptr, 16)));
        if (colours.size() > 768)
            throw std::invalid_argument("Palette contains more than 256 colours");
    }
    if (colours.empty())
        throw std::invalid_argument("Palette is empty");
    return colours;
}
void writable(const std::string &path, bool force) {
    if (!path.empty() && std::filesystem::exists(path) && !force)
        throw std::runtime_error("Output exists: " + path + " (use --force)");
}
} // namespace
int main(int argc, char **argv) {
    try {
        std::vector<std::string> paths;
        std::map<std::string, std::string> flags;
        bool force = false;
        for (int i = 1; i < argc; i++) {
            const std::string key = argv[i];
            if (key == "--help") {
                std::cout << help;
                return 0;
            }
            if (key == "--version") {
                std::cout << "0.3.0\n";
                return 0;
            }
            if (key == "--force") {
                force = true;
                continue;
            }
            if (key.starts_with("--")) {
                const std::vector<std::string> valid = {
                    "--width",      "--height",      "--colours",  "--colors",
                    "--palette",    "--dither",      "--strength", "--resample",
                    "--palette-in", "--palette-out", "--report"};
                if (std::find(valid.begin(), valid.end(), key) == valid.end() || i + 1 >= argc)
                    throw std::invalid_argument("Unknown option or missing value: " + key);
                flags[key] = argv[++i];
            } else
                paths.push_back(key);
        }
        if (paths.size() != 2)
            throw std::invalid_argument("Expected INPUT and OUTPUT paths; use --help");
        auto extension = std::filesystem::path(paths[1]).extension().string();
        std::transform(extension.begin(), extension.end(), extension.begin(),
                       [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        if (extension != ".png")
            throw std::invalid_argument("Output filename must end in .png");
        const auto inputPath = std::filesystem::weakly_canonical(paths[0]);
        std::vector<std::filesystem::path> outputPaths;
        for (const auto &path : {paths[1], flags["--palette-out"], flags["--report"]})
            if (!path.empty()) {
                const auto absolute = std::filesystem::weakly_canonical(path);
                if (absolute == inputPath || std::find(outputPaths.begin(), outputPaths.end(),
                                                       absolute) != outputPaths.end())
                    throw std::invalid_argument("Input and output paths must be distinct");
                outputPaths.push_back(absolute);
                writable(path, force);
            }
        const auto image = crtvd::io::read(paths[0]);
        crtvd::Options o;
        o.width = flags.contains("--width") ? number(flags["--width"]) : std::min(160, image.width);
        if (o.width < 1 || o.width > image.width)
            throw std::invalid_argument("Width must be positive and must not upscale the source");
        o.height = flags.contains("--height")
                       ? number(flags["--height"])
                       : std::max(1, static_cast<int>(std::lround(static_cast<double>(o.width) *
                                                                  image.height / image.width)));
        if (flags.contains("--colours"))
            o.colours = number(flags["--colours"]);
        else if (flags.contains("--colors"))
            o.colours = number(flags["--colors"]);
        if (flags.contains("--strength"))
            o.strength = decimal(flags["--strength"]);
        if (flags.contains("--palette"))
            o.palette =
                std::map<std::string, crtvd::PaletteMode>{
                    {"adaptive", crtvd::PaletteMode::Adaptive},
                    {"monochrome", crtvd::PaletteMode::Monochrome},
                    {"handheld", crtvd::PaletteMode::Handheld},
                    {"cga", crtvd::PaletteMode::Cga}}
                    .at(flags["--palette"]);
        if (flags.contains("--dither"))
            o.dither =
                std::map<std::string, crtvd::Dither>{{"none", crtvd::Dither::None},
                                                     {"bayer", crtvd::Dither::Bayer4},
                                                     {"floyd", crtvd::Dither::FloydSteinberg}}
                    .at(flags["--dither"]);
        if (flags.contains("--resample"))
            o.resample =
                std::map<std::string, crtvd::Resample>{{"area", crtvd::Resample::Area},
                                                       {"nearest", crtvd::Resample::Nearest}}
                    .at(flags["--resample"]);
        const auto custom = flags.contains("--palette-in") ? read_palette(flags["--palette-in"])
                                                           : std::vector<std::uint8_t>{};
        const auto start = std::chrono::steady_clock::now();
        const auto result = crtvd::process(image.rgba, image.width, image.height, o, custom);
        const double ms =
            std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start)
                .count();
        crtvd::io::write_png(paths[1], result.width, result.height, result.rgba, force);
        if (!flags["--palette-out"].empty()) {
            std::ofstream file(flags["--palette-out"]);
            if (!file)
                throw std::runtime_error("Cannot write palette");
            for (std::size_t i = 0; i < result.palette.size(); i += 3) {
                file << '#';
                for (int c = 0; c < 3; c++)
                    file << std::hex << std::setfill('0') << std::setw(2)
                         << static_cast<int>(result.palette[i + c]);
                file << '\n';
            }
        }
        if (!flags["--report"].empty()) {
            std::ofstream file(flags["--report"]);
            if (!file)
                throw std::runtime_error("Cannot write report");
            file << "{\"version\":\"0.3.0\",\"width\":" << result.width
                 << ",\"height\":" << result.height << ",\"processingMs\":" << ms
                 << ",\"palette\":[";
            for (std::size_t i = 0; i < result.palette.size(); i++) {
                if (i)
                    file << ',';
                file << static_cast<int>(result.palette[i]);
            }
            file << "]}\n";
        }
        std::cout << result.width << "x" << result.height << ", " << result.palette.size() / 3
                  << " RGB colours, " << std::fixed << std::setprecision(2) << ms
                  << " ms engine time\n";
        return 0;
    } catch (const std::invalid_argument &e) {
        std::cerr << "crtvd: " << e.what() << '\n';
        return 2;
    } catch (const std::out_of_range &) {
        std::cerr << "crtvd: invalid numeric value or processing mode\n";
        return 2;
    } catch (const std::exception &e) {
        std::cerr << "crtvd: " << e.what() << '\n';
        return 1;
    }
}
