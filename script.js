document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const fileInput = document.getElementById('fileInput');
    const demoThumbnails = document.querySelectorAll('#demo-thumbnails img');
    const mainOutput = document.getElementById('main-output');
    const canvas = document.getElementById('display-canvas');
    const ctx = canvas.getContext('2d');
    
    const speedSlider = document.getElementById('speed');
    const speedValue = document.getElementById('speedValue');
    const offsetSlider = document.getElementById('offset');
    const offsetValue = document.getElementById('offsetValue');
    const cropCheckbox = document.getElementById('crop');
    
    const exportGifBtn = document.getElementById('exportGif');
    const exportWebmBtn = document.getElementById('exportWebm');
    const statusText = document.getElementById('status');

    // --- App State ---
    let leftImage, rightImage;
    let animationInterval;
    let settings = {
        speed: 8,
        offset: 64,
        crop: true
    };
    let currentFrame = 0;

    // --- MPO Parsing Logic ---
    // Replicates the original Lua script's logic: find the first SOS marker,
    // then find the next SOI marker to split the file.
    function parseMPO(arrayBuffer) {
        const view = new Uint8Array(arrayBuffer);
        
        // Find first Start of Scan (SOS) marker (FF DA)
        let firstSOS = -1;
        for (let i = 0; i < view.length - 1; i++) {
            if (view[i] === 0xFF && view[i + 1] === 0xDA) {
                firstSOS = i;
                break;
            }
        }
        if (firstSOS === -1) {
            throw new Error('Could not find SOS marker in the first image.');
        }

        // Find next Start of Image (SOI) marker (FF D8) after the first SOS
        let splitPoint = -1;
        for (let i = firstSOS; i < view.length - 1; i++) {
            if (view[i] === 0xFF && view[i + 1] === 0xD8) {
                splitPoint = i;
                break;
            }
        }

        if (splitPoint === -1) {
            throw new Error('Not a valid MPO file (could not find second image).');
        }

        const img1Data = view.subarray(0, splitPoint);
        const img2Data = view.subarray(splitPoint);

        const img1Blob = new Blob([img1Data], { type: 'image/jpeg' });
        const img2Blob = new Blob([img2Data], { type: 'image/jpeg' });

        return [img1Blob, img2Blob];
    }
    
    // --- Image Loading ---
    async function loadImages(file) {
        statusText.textContent = 'Processing file...';
        try {
            const buffer = await file.arrayBuffer();
            const [blob1, blob2] = parseMPO(buffer);

            const loadImage = (blob) => new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = URL.createObjectURL(blob);
            });

            [leftImage, rightImage] = await Promise.all([loadImage(blob1), loadImage(blob2)]);
            
            mainOutput.classList.remove('hidden');
            statusText.textContent = '';
            updateAnimation();

        } catch (error) {
            alert(`Error: ${error.message}`);
            statusText.textContent = 'Failed to load file.';
        }
    }
    
    // --- Canvas Drawing & Animation ---
    function draw() {
        if (!leftImage || !rightImage) return;

        const imgToDraw = currentFrame === 0 ? leftImage : rightImage;
        const w = leftImage.width;
        const h = leftImage.height;
        const offset = parseInt(settings.offset, 10);
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (settings.crop) {
            canvas.width = w - offset;
            canvas.height = h;
            // Crop 'offset' pixels from the right of the left image
            // and from the left of the right image to align them.
            const sx = (currentFrame === 0) ? 0 : offset;
            ctx.drawImage(imgToDraw, sx, 0, w - offset, h, 0, 0, w - offset, h);
        } else { // Pad
            canvas.width = w + offset;
            canvas.height = h;
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Draw left image at (0,0), draw right image shifted by 'offset'
            const dx = (currentFrame === 0) ? 0 : offset;
            ctx.drawImage(imgToDraw, dx, 0, w, h);
        }
    }

    function updateAnimation() {
        clearInterval(animationInterval);
        draw(); // Draw immediately with new settings
        const frameDelay = 1000 / (settings.speed * 2); // *2 because a wiggle is two frames
        animationInterval = setInterval(() => {
            currentFrame = 1 - currentFrame; // Toggle between 0 and 1
            draw();
        }, frameDelay);
    }
    
    // --- Event Handlers ---
    function handleControlsChange() {
        settings.speed = speedSlider.value;
        settings.offset = offsetSlider.value;
        settings.crop = cropCheckbox.checked;

        speedValue.textContent = settings.speed;
        offsetValue.textContent = settings.offset;
        
        updateAnimation();
    }
    
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            loadImages(file);
        }
    });

    demoThumbnails.forEach(thumb => {
        thumb.addEventListener('click', async (e) => {
            const { src, speed, offset } = e.target.dataset;
            statusText.textContent = 'Loading demo...';
            try {
                const response = await fetch(src);
                if (!response.ok) throw new Error(`Could not fetch demo file.`);
                const blob = await response.blob();
                
                // Set controls to demo defaults
                speedSlider.value = speed;
                offsetSlider.value = offset;
                cropCheckbox.checked = true; // Demos are best viewed cropped
                handleControlsChange(); // Update state and UI
                
                await loadImages(blob);

            } catch (error) {
                alert(`Error: ${error.message}`);
                statusText.textContent = 'Failed to load demo.';
            }
        });
    });

    [speedSlider, offsetSlider, cropCheckbox].forEach(el => {
        el.addEventListener('input', handleControlsChange);
    });

    // --- Export Logic ---
    function setExportingState(isExporting, message) {
        exportGifBtn.disabled = isExporting;
        exportWebmBtn.disabled = isExporting;
        statusText.textContent = message;
    }

    function triggerDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    exportGifBtn.addEventListener('click', () => {
        if (!leftImage) return;
        setExportingState(true, 'Generating GIF...');

        const frameDelay = 1000 / (settings.speed * 2);
        const gif = new GIF({
            workers: 2,
            quality: 10,
            width: canvas.width,
            height: canvas.height,
        });

        // Add frames from an offscreen canvas
        const offscreenCanvas = document.createElement('canvas');
        const offscreenCtx = offscreenCanvas.getContext('2d');
        
        // Draw and add frame 1 (left)
        currentFrame = 0;
        draw.call({ canvas: offscreenCanvas, ctx: offscreenCtx }); // Manually draw to offscreen
        gif.addFrame(offscreenCtx, { copy: true, delay: frameDelay });
        
        // Draw and add frame 2 (right)
        currentFrame = 1;
        draw.call({ canvas: offscreenCanvas, ctx: offscreenCtx }); // Manually draw to offscreen
        gif.addFrame(offscreenCtx, { copy: true, delay: frameDelay });

        gif.on('finished', (blob) => {
            triggerDownload(blob, 'wigglegram.gif');
            setExportingState(false, 'GIF exported!');
        });
        
        gif.render();
    });

    exportWebmBtn.addEventListener('click', () => {
        if (!leftImage) return;

        if (!window.MediaRecorder || !canvas.captureStream) {
            alert("Video export is not supported in your browser.");
            return;
        }

        setExportingState(true, 'Recording video...');
        
        const chunks = [];
        const stream = canvas.captureStream(settings.speed * 2); // Match frame rate
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });

        recorder.ondataavailable = e => chunks.push(e.data);
        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            triggerDownload(blob, 'wigglegram.webm');
            setExportingState(false, 'WebM exported!');
        };
        
        recorder.start();
        setTimeout(() => recorder.stop(), 5000); // Record for 5 seconds
    });
});