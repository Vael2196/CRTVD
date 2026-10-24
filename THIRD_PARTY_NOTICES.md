# Third-party notices

## Oklab transform

The Oklab conversion in `engine/src/engine.cpp` follows the published transform
and MIT-licensed reference implementation by Björn Ottosson:
https://bottosson.github.io/posts/oklab/

Copyright (c) 2020 Björn Ottosson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Runtime and web dependencies

React/React DOM and all build/test dependencies retain their package licences.
Emscripten's generated loader and linked runtime components retain the licences
from the corresponding SDK distribution. No external image, icon, or font asset
is bundled; the landscape sample and decorative UI shapes are generated locally.

## Animation dependencies

The GIF reader uses gifuct-js 2.1.2 (MIT, copyright 2015 Matt Way).
The GIF writer uses gifenc 1.0.3 (MIT, copyright 2017 Matt DesLauriers).
Their full licence texts are distributed in `web/public/notices/`.

Video containers and WebCodecs integration use Mediabunny 1.62.1, under the
Mozilla Public License 2.0. Its source is used unmodified. The source-bearing
package is available at:
https://registry.npmjs.org/mediabunny/-/mediabunny-1.62.1.tgz

The full MPL 2.0 text is distributed in `web/public/notices/mediabunny-MPL-2.0.txt`.
Third-party components remain under their respective licences.

## Native CLI image codecs

The native image-I/O layer uses unmodified stb_image and stb_image_write,
from nothings/stb revision 003501f6d7a8668ce8b6d875e34dd97ad0d5d5b5.
The project uses the MIT licence option provided by those headers. Their full
licence and source checksums are in engine/vendor/. These headers are not
compiled into the browser engine or the TypeScript package.
