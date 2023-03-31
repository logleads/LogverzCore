/**
 * This function load font from web, stores it in localStorage and reuses on next page loads
 * Different to everything I found on the internet due to following facts
 * 1. Checks if the font is installed in the system and spend no time if it is
 * 2. Loads actual WOFF or WOFF2 fonts (if supported) and not bit base64 encoded version - so it faster
 * 3. Uses fetch API and FontFace API if available - it's cool!
 * 4. Return promises and uses jQuery for cases where native promises probably not available
 * 
 * @param fontName (Field for font-face)
 * @param fontUrl (full URL but without .woff nor .woff2 extensions - format will be selected automatically)
 * @param fontWeight (400 - normal, 700 - bold, etc)
 * @param fontStyle ('normal' - default, 'italic', 'opaque', etc)
 * @returns (promise and add to <html> element CSS class 'tsf-fontName-active' on font load)
 */
function loadFont(fontName, fontUrl, fontWeight, fontStyle) {
    var fWeight = fontWeight || 400,
        fStyle = fontStyle || 'normal',
        activeClass = 'tsf-' + fontName.toLowerCase().split(' ').join('-') + '-active';

    // We use static array of added font faces
    if (typeof loadFont.fontsLoaded == 'undefined') {
        // It has not... perform the initialization
        loadFont.fontsLoaded = [];
    }

    return new Promise(function (resolve, reject) {

        
        const request = new Request(`${fontUrl}.ttf`,);
        request.headers.append('accept', 'font/ttf');
        return fetch(request)
            .then(function (response) {
                // 404, 500 etc errors comes here to, so, we need to check for result
                if (response.status > 100 && response.status < 400) {
                    return response.blob();
                } else {
                    throw response.statusText;
                }
            })
            .then(function (fontBlob) {
                // We will add it to document with another shinning new CSS3 Font-Loading API
                // https://developer.mozilla.org/en-US/docs/Web/API/CSS_Font_Loading_API
                var fnt = new FontFace(fontName, `url(${URL.createObjectURL(fontBlob)})`, { style: fStyle, weight: fWeight });
                document.fonts.add(fnt);
                fnt.load();
            })
            .catch(function (e) {
                console.error(`Failed to load font from ${fontUrl}.ttf with error: ${e}`);
            });

    });
}