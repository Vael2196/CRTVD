#include "crtvd/engine.hpp"
#include "image_io.hpp"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <vector>

int main(int argc, char **argv) {
    try {
        if (argc < 2)
            throw std::runtime_error("Usage: crtvd-bench INPUT.png [runs] [warmup]");
        const auto image = crtvd::io::read(argv[1]);
        const int runs = argc > 2 ? std::stoi(argv[2]) : 15,
                  warmup = argc > 3 ? std::stoi(argv[3]) : 3;
        if (runs < 3 || runs > 1000 || warmup < 0 || warmup > 100)
            throw std::runtime_error("Invalid run count");
        std::cout << "{\"compiler\":\"" << __VERSION__ << "\",\"cases\":[";
        std::uint64_t checksum = 0;
        for (int c = 0; c < 3; c++) {
            crtvd::Options o;
            o.width = c == 0 ? 160 : c == 1 ? 320 : 512;
            o.height = static_cast<int>(
                std::lround(static_cast<double>(o.width) * image.height / image.width));
            o.colours = c == 0 ? 16 : c == 1 ? 32 : 64;
            o.dither = c == 0   ? crtvd::Dither::Bayer4
                       : c == 1 ? crtvd::Dither::FloydSteinberg
                                : crtvd::Dither::None;
            std::vector<double> times;
            for (int i = -warmup; i < runs; i++) {
                const auto start = std::chrono::steady_clock::now();
                const auto result = crtvd::process(image.rgba, image.width, image.height, o);
                const auto ms = std::chrono::duration<double, std::milli>(
                                    std::chrono::steady_clock::now() - start)
                                    .count();
                if (i >= 0)
                    times.push_back(ms);
                checksum +=
                    result.rgba[(static_cast<std::size_t>(i + warmup) * 17) % result.rgba.size()];
            }
            auto sorted = times;
            std::sort(sorted.begin(), sorted.end());
            if (c)
                std::cout << ',';
            std::cout << "{\"width\":" << o.width << ",\"height\":" << o.height
                      << ",\"colours\":" << o.colours << ",\"dither\":\""
                      << (c == 0   ? "bayer"
                          : c == 1 ? "floyd"
                                   : "none")
                      << "\",\"runsMs\":[";
            for (std::size_t i = 0; i < times.size(); i++) {
                if (i)
                    std::cout << ',';
                std::cout << times[i];
            }
            std::cout << "],\"medianMs\":" << sorted[sorted.size() / 2] << ",\"p95Ms\":"
                      << sorted[static_cast<std::size_t>(std::ceil(sorted.size() * .95)) - 1]
                      << '}';
        }
        std::cout << "],\"checksum\":" << checksum << "}\n";
        return 0;
    } catch (const std::exception &e) {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
