# Palette and effects guide

## Change or share a palette

Select a swatch beneath the result. You can use the colour wheel, enter hex or RGB values,
or adjust the hue, saturation and brightness sliders. **Suggested colours** shows nearby
colours from the current palette, plus colours that harmonise or contrast with the chosen swatch.
Click **Apply colour** when you're ready. CRTVD replaces that palette entry wherever it occurs,
so the dither pattern and the alpha of each pixel stay the same. After an animation has been
converted, committing a swatch edit renders the clip again.

**Default palette** appears after an edit or import. It restores the palette for the selected
preset or palette mode. Selecting a different preset also clears the override.

Open **Import / export palette** to copy a code or paste one into a different image or clip.
For example, `CRTVD1:0A17262C6084BBDAE8E7462D` contains four ordered RGB colours. The code
has no media, effect settings or metadata, and CRTVD doesn't upload or store it. An imported
palette is a fixed set of colours; CRTVD matches the pixels in the new source to that set.
Codes accept up to 256 distinct colours, or 255 when exporting GIF so an entry is available
for transparency.

Try **Cross Section**, **Last Train** or **Silver Terminal** for a Soft Club look, or select
**Show 18 retro console palettes** for more sets. The recommendations also include
**Anime Orange & Green**, **Sega CD Weirdcore**, **90s Anime**, **Addams Family Vibes** and
**90s Grunge**. The themed presets are aesthetic sets rather than reproductions of
a particular console's hardware palette.

## Blend and add colour fringing

Open **Advanced settings** in the still or animation editor and choose **Blend with source**.
Drag handles **A** and **B** along any of the four edges to position the divider. With a
handle focused, use the arrow keys to move it around the perimeter; hold Shift for larger
steps. The vertical and horizontal buttons give you starting points, and **Swap sides**
exchanges the source and conversion.

| Blend mode      | What it does                                                                       |
| --------------- | ---------------------------------------------------------------------------------- |
| Direct          | Draws a sharp split between the source and conversion.                             |
| Feather / alpha | Crossfades across the split in linear light. **Feather width** controls the band.  |
| Pyramid         | Blends coarse colour and fine detail at different scales to soften the transition. |

The source is sampled at the processing resolution. The divider handles and guide line are
editor overlays; only the composite is exported. The regular still-image comparison remains
available separately. Use **Preview first frame** to check the seam in animation mode, then
**Convert animation** to render the full clip. When an adaptive palette hasn't been learned
yet, the first-frame preview estimates it from that frame.

**Chromatic aberration** shifts the red and blue channels in opposite directions, with the
shift increasing towards the edges. **Purple fringing** adds a violet tint next to bright
edges. Both controls work on the converted layer before blending. The original side stays
clean outside the transition. For a sharp separation, use **Direct seam**; with a feather
or pyramid blend, the two layers share a transition band.

## Blur, colour targeting and ASCII

**Blur type** offers Gaussian for soft focus, Median for small specks, and Bilateral for
smoothing while retaining edges. **Blur radius** is measured in processing pixels. With
Bilateral, increase **Edge softness** to allow more mixing across contrasting colours.
Blur preserves each pixel's alpha.

Use **Apply effects to** to choose **All except selected (lock)** or **Only selected**,
then toggle the relevant swatches under **Colour targeting**. Matching uses the exact
palette colour after any manual replacements, before applying blur, fringes or ASCII.
A protected pixel keeps its converted RGBA on that layer. Neighbourhood filters can still
sample it to calculate adjacent pixels. The seam is composited separately and can still
mix protected pixels with the source in the transition band. Selections are stored only
for the current editor session and remembered by hex when switching palettes.

**Render as ASCII** builds a glyph grid from the brightness of the converted pixels.
Set **ASCII cell size** to control density (smaller cells fit more symbols), and
**ASCII glyph size** to set how much of each cell the glyph occupies. Select a built-in
symbol set or enter up to 32 printable ASCII characters from lightest to heaviest.
A space draws no ink. **Invert symbol ramp** reverses that order; **ASCII tonal contrast**
controls how strongly values move towards the ends of the ramp. Choose converted colours
or white ink on a black background. Existing alpha is retained. The glyphs are rasterised
into the image or animation at the current processing resolution.

**Reset effects** clears the blend, filters, colour targets and ASCII. CRTVD applies blur,
then fringes, then ASCII to the converted layer before putting it together with the source.

A composite can contain colours beyond the working palette. PNG can keep those colours. GIF
has room for 255 opaque colours and one transparent entry, so CRTVD reserves the chosen colours
and uses any free entries for colours learned from the effected or composited frames. That adds a pass over
the clip when there are slots available. Frame timing and loop settings still follow the source.
GIF still has binary transparency; video exports use their usual codec and background settings.

## References

The Soft Club presets draw on the two supplied editorial references and
[Envato's overview of the aesthetic](https://elements.envato.com/learn/gen-x-soft-club-aesthetic).
The expanded preset RGB values come from [ColorAny's retro console palette collection](https://colorany.com/color-palettes/retro-console-color-palettes/).
**Anime Orange & Green** uses the RGB values from
[cooperism's Color Hex palette](https://www.color-hex.com/color-palette/106591). The other
four new sets come from the [ColorMagic 90s gallery](https://colormagic.app/palette/explore/90s).
These values are bundled, with no remote palette calls.

The colour picker uses hue relationships described in
[Tuts+ Colour Fundamentals](https://design.tutsplus.com/articles/color-fundamentals-shading--cms-20549)
and [Dave Morrow's colour theory guide](https://www.davemorrowphotography.com/color-theory-photography).
The pyramid blend follows the Gaussian-mask and Laplacian-level approach described in
[OpenCV's image pyramids tutorial](https://docs.opencv.org/4.13.0/dc/dff/tutorial_py_pyramids.html).

The [Gaussian blur overview](https://en.wikipedia.org/wiki/Gaussian_blur), Chinmayi Adsul's
[median](https://medium.com/@chinmayiadsul/the-art-of-blur-in-image-processing-part-2-median-blur-the-noise-assassin-c52bef009e5b)
and [bilateral](https://medium.com/@chinmayiadsul/the-art-of-blur-in-image-processing-part-3-bilateral-blur-the-diplomat-0fcfd3d5ee30)
articles, and the [ASCII art overview](https://en.wikipedia.org/wiki/ASCII_art) provided
background. CRTVD rasterises ASCII using [font8x8](https://github.com/dhepper/font8x8),
a public-domain bitmap font.
