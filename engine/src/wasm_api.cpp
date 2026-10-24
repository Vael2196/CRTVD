#include "crtvd/engine.hpp"

#include <cstdio>
#include <exception>
#include <new>
#include <stdexcept>

namespace {
// Each Wasm module is used by one worker. No shared/global engine instance.
char last_error[256]{};
} // namespace

extern "C" {
// A C ABI avoids C++ name mangling and exposes a small, explicit ownership API.
crtvd::Result *crtvd_process(const std::uint8_t *input, std::size_t length, int iw, int ih, int ow,
                             int oh, int palette, int colours, int dither, float strength,
                             int resample) noexcept {
    last_error[0] = '\0';
    try {
        if (!input)
            throw std::invalid_argument("Input pointer is null");
        crtvd::Options o;
        o.width = ow;
        o.height = oh;
        o.palette = static_cast<crtvd::PaletteMode>(palette);
        o.colours = colours;
        o.dither = static_cast<crtvd::Dither>(dither);
        o.strength = strength;
        o.resample = static_cast<crtvd::Resample>(resample);
        return new crtvd::Result(crtvd::process({input, length}, iw, ih, o));
    } catch (const std::exception &e) {
        std::snprintf(last_error, sizeof(last_error), "%s", e.what());
    } catch (...) {
        std::snprintf(last_error, sizeof(last_error), "Unknown processing error");
    }
    return nullptr;
}
const char *crtvd_last_error() noexcept {
    return last_error;
}
const std::uint8_t *crtvd_result_pixels(const crtvd::Result *r) noexcept {
    return r ? r->rgba.data() : nullptr;
}
std::size_t crtvd_result_length(const crtvd::Result *r) noexcept {
    return r ? r->rgba.size() : 0;
}
const std::uint8_t *crtvd_result_palette(const crtvd::Result *r) noexcept {
    return r ? r->palette.data() : nullptr;
}
std::size_t crtvd_result_palette_length(const crtvd::Result *r) noexcept {
    return r ? r->palette.size() : 0;
}
void crtvd_result_free(crtvd::Result *r) noexcept {
    delete r;
}
}
