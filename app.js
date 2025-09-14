document.addEventListener("DOMContentLoaded", () => {
    const GITHUB_OWNER = "elo613";
    const GITHUB_REPO = "PrivateFoodData";
    const REVIEWS_FILE_PATH = "reviews.json";
    const PAT_FILE = "pat.enc.json";

    // --- ApiService ---
    const ApiService = {
        _getApiUrl: path => `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(path)}`,
        _getRawUrl: path => `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/${encodeURIComponent(path)}`,
        _xorCipher: (str, key) => str.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ key.charCodeAt(i % key.length))).join(''),
        _decryptPat: (data, key) => ApiService._xorCipher(atob(data), key).trim(),
        _isValidGitHubToken: token => token && typeof token === 'string' && ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_'].some(p => token.startsWith(p)) && token.length >= 40,

        async getPat(password) {
            const res = await fetch(`./${PAT_FILE}?t=${Date.now()}`);
            if (!res.ok) throw new Error("Could not fetch local PAT file.");
            const { data } = await res.json();
            const token = this._decryptPat(data, password);
            if (!this._isValidGitHubToken(token)) throw new Error("Incorrect password or token decryption failed.");
            return token;
        },

        async fetchReviews(token) {
            const res = await fetch(`${this._getApiUrl(REVIEWS_FILE_PATH)}?t=${Date.now()}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3.raw' }
            });
            if (res.status === 404) return [];
            if (!res.ok) throw new Error("Failed to fetch reviews.");
            return await res.json();
        },

        async saveReviews(reviews, token) {
            const url = this._getApiUrl(REVIEWS_FILE_PATH);
            let sha = null;
            try {
                const metaRes = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' }
                });
                if (metaRes.ok) {
                    const meta = await metaRes.json();
                    sha = meta.sha;
                }
            } catch (e) {
                // If the file doesn't exist, we can ignore the error and proceed without a sha.
            }
            const jsonContent = JSON.stringify(reviews, null, 2);
            const base64Content = btoa(new TextEncoder().encode(jsonContent).reduce((d, b) => d + String.fromCharCode(b), ''));
            const body = { message: `Update reviews ${new Date().toISOString()}`, content: base64Content };
            if (sha) body.sha = sha;
            const res = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            if (!res.ok) throw new Error(`Failed to save reviews: ${res.statusText}`);
            return await res.json();
        },

// ... inside ApiService ...

        _compressImage(file) {
            return new Promise((resolve, reject) => {
                // More conservative options for mobile
                const options = {
                    maxWidth: 600,  // Reduced from 800
                    maxHeight: 600, // Reduced from 800
                    quality: 0.8,   // Slightly higher quality
                    maxFileSize: 1024 * 1024 // 1MB target instead of 2MB
                };
        
                // If file is already small enough, don't compress
                if (file.size <= options.maxFileSize) {
                    return resolve(file);
                }
        
                const image = new Image();
                image.crossOrigin = "anonymous"; // Important for mobile browsers
                
                const cleanup = () => {
                    URL.revokeObjectURL(image.src);
                };
        
                image.onload = () => {
                    try {
                        let { width, height } = image;
                        
                        // More aggressive scaling for mobile
                        const ratio = Math.min(
                            options.maxWidth / width, 
                            options.maxHeight / height, 
                            1
                        );
                        
                        width = Math.floor(width * ratio);
                        height = Math.floor(height * ratio);
                        
                        // Ensure minimum dimensions
                        if (width < 1 || height < 1) {
                            cleanup();
                            return reject(new Error('Image dimensions too small after scaling'));
                        }
                        
                        const canvas = document.createElement('canvas');
                        canvas.width = width;
                        canvas.height = height;
                        
                        const ctx = canvas.getContext('2d');
                        if (!ctx) {
                            cleanup();
                            return reject(new Error('Could not get canvas context'));
                        }
                        
                        // Better quality settings for mobile
                        ctx.imageSmoothingEnabled = true;
                        ctx.imageSmoothingQuality = 'high';
                        ctx.drawImage(image, 0, 0, width, height);
        
                        // Try toBlob first, with immediate fallback to toDataURL
                        const tryToBlob = () => {
                            try {
                                canvas.toBlob((blob) => {
                                    if (blob && blob.size > 0) {
                                        const compressedFile = new File([blob], 
                                            file.name.replace(/\.\w+$/, '.jpg'), {
                                            type: 'image/jpeg',
                                            lastModified: Date.now(),
                                        });
                                        cleanup();
                                        resolve(compressedFile);
                                    } else {
                                        // Fallback to toDataURL
                                        fallbackToDataURL();
                                    }
                                }, 'image/jpeg', options.quality);
                            } catch (error) {
                                console.warn('toBlob failed, using toDataURL:', error);
                                fallbackToDataURL();
                            }
                        };
        
                        const fallbackToDataURL = () => {
                            try {
                                const dataUrl = canvas.toDataURL('image/jpeg', options.quality);
                                if (dataUrl && dataUrl.length > 100) { // Basic validation
                                    const byteString = atob(dataUrl.split(',')[1]);
                                    const buffer = new ArrayBuffer(byteString.length);
                                    const intArray = new Uint8Array(buffer);
                                    
                                    for (let i = 0; i < byteString.length; i++) {
                                        intArray[i] = byteString.charCodeAt(i);
                                    }
                                    
                                    const fallbackFile = new File([intArray], 
                                        file.name.replace(/\.\w+$/, '.jpg'), {
                                        type: 'image/jpeg',
                                        lastModified: Date.now(),
                                    });
                                    
                                    cleanup();
                                    resolve(fallbackFile);
                                } else {
                                    cleanup();
                                    reject(new Error('Failed to create data URL'));
                                }
                            } catch (error) {
                                cleanup();
                                reject(new Error('Both toBlob and toDataURL failed: ' + error.message));
                            }
                        };
        
                        // Use setTimeout to prevent blocking the UI on mobile
                        setTimeout(tryToBlob, 10);
        
                    } catch (error) {
                        cleanup();
                        reject(new Error('Image processing failed: ' + error.message));
                    }
                };
        
                image.onerror = () => {
                    cleanup();
                    reject(new Error('Failed to load image for compression'));
                };
        
                // Set src last, after all event handlers are attached
                image.src = URL.createObjectURL(file);
            });
        },

        async uploadImage(file, token) {
            const sanitized = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
            const fileName = `images/${Date.now()}_${sanitized}`;
            const url = this._getApiUrl(fileName);
            const base64Content = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                  const result = reader.result;
                  const base64 = result.includes(',') ? result.split(',')[1] : result;
                  resolve(base64);
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            const body = { message: `Upload image ${file.name}`, content: base64Content };
            const res = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            if (!res.ok) throw new Error(`Image upload failed: ${res.statusText}`);
            const data = await res.json();
            return data.content.path;
        },
        
        async fetchPrivateImageAsDataUrl(path, token) {
             const url = this._getApiUrl(path);
             const res = await fetch(url, {
                 headers: {
                     'Authorization': `Bearer ${token}`,
                     'Accept': 'application/vnd.github.v3.raw'
                 }
             });
             if (!res.ok) {
                 console.error("Failed to fetch image from API:", path);
                 return null;
             }
             const blob = await res.blob();
             return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
             });
         }
    };

    // --- UIManager ---
    const UIManager = {
        loginScreen: document.getElementById("loginScreen"),
        loginForm: document.getElementById("loginForm"),
        loginPassword: document.getElementById("loginPassword"),
        loginError: document.getElementById("loginError"),
        loginLoading: document.getElementById("loginLoading"),
        app: document.getElementById("app"),
        logoutBtn: document.getElementById("logoutBtn"),
        addTab: document.getElementById("addTab"),
        readTab: document.getElementById("readTab"),
        addReviewContent: document.getElementById("addReviewContent"),
        readReviewsContent: document.getElementById("readReviewsContent"),
        reviewForm: document.getElementById("reviewForm"),
        reviewsList: document.getElementById("reviewsList"),
        imageUpload: document.getElementById("imageUpload"),
        imagePreview: document.getElementById("imagePreview"),
        imageProgress: document.getElementById("imageProgress"), // <-- ADDED
        toast: document.getElementById("toast"),

        showToast(msg, error = false) {
            this.toast.textContent = msg;
            this.toast.className = `fixed bottom-5 right-5 px-4 py-2 rounded-lg shadow-xl text-white transition-all transform ${error ? 'bg-red-600' : 'bg-green-600'}`;
            this.toast.classList.remove("opacity-0", "translate-y-4");
            setTimeout(() => this.toast.classList.add("opacity-0", "translate-y-4"), 3000);
        },

        updateView({ token, activeTab, isBusy }) {
            this.app.classList.toggle('hidden', !token);
            this.loginScreen.classList.toggle('hidden', !!token);
            if (!token) return;

            const isAdd = activeTab === 'add';
            this.addTab.classList.toggle('tab-active', isAdd);
            this.readTab.classList.toggle('tab-active', !isAdd);
            this.addReviewContent.classList.toggle('hidden', !isAdd);
            this.readReviewsContent.classList.toggle('hidden', isAdd);

            const button = this.reviewForm.querySelector('button[type="submit"]');
            if (button) {
                button.disabled = isBusy;
                button.classList.toggle('loading', isBusy);
            }
        },

        resetForm() {
            this.reviewForm.reset();
            this.imagePreview.src = '';
            this.imagePreview.classList.add('hidden');
            this.imageProgress.classList.add('hidden');
        },

        _createReviewHTML(r, i) {
            const { restaurant, foodItem, price, taste, texture, size, value, EL, AG, timestamp, image } = r;
            const date = new Date(timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            const imageHtml = image ? `<img data-image-path="${image}" class="mb-3 max-h-72 w-full object-cover rounded-md bg-gray-200">` : '';

            return `<div class="p-4 border border-gray-200 rounded-lg bg-white flex flex-col" data-index="${i}">
                ${imageHtml}
                <div class="flex-grow">
                    <div class="flex justify-between items-start gap-4">
                        <div>
                            <h3 class="text-xl font-bold text-blue-600">${restaurant}</h3>
                            <p class="text-gray-700">${foodItem} - £${parseFloat(price).toFixed(2)}</p>
                        </div>
                        <button class="font-semibold text-sm text-red-500 hover:text-red-700 flex-shrink-0" data-action="delete">Delete</button>
                    </div>
                    <div class="mt-2 pt-2 border-t grid grid-cols-3 sm:grid-cols-7 gap-2 text-sm text-gray-600">
                        <span>Taste: <strong>${taste}</strong></span>
                        <span>Texture: <strong>${texture}</strong></span>
                        <span>Size: <strong>${size}</strong></span>
                        <span>Value: <strong>${value}</strong></span>
                        <span>EL: <strong>${EL}</strong></span>
                        <span>AG: <strong>${AG}</strong></span>
                    </div>
                </div>
                <p class="mt-3 text-xs text-gray-400 text-right">Added: ${date}</p>
            </div>`;
        },

        renderReviews(reviews, token) {
            this.reviewsList.innerHTML = reviews.length ? reviews.slice().reverse().map((r, i) => this._createReviewHTML(r, reviews.length - 1 - i)).join('') : `<p class="text-gray-500 text-center py-8">No reviews yet.</p>`;
            if (token) {
                this.reviewsList.querySelectorAll('img[data-image-path]').forEach(img => {
                    const path = img.dataset.imagePath;
                    ApiService.fetchPrivateImageAsDataUrl(path, token).then(dataUrl => {
                        if (dataUrl) {
                            img.src = dataUrl;
                            img.onload = () => img.classList.remove('bg-gray-200');
                        }
                    });
                });
            }
        },

        populateRatingSelectors() {
            ['taste', 'texture', 'size', 'value'].forEach(id => {
                const select = document.getElementById(id);
                select.innerHTML = Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
            });
            ['EL', 'AG'].forEach(id => {
                document.getElementById(id).innerHTML = `<option value="Yes">Yes</option><option value="No">No</option>`;
            });
        }
    };

    // --- AppController ---
    const AppController = {
        state: {
            token: sessionStorage.getItem('github_pat') || null,
            reviews: [],
            activeTab: 'read',
            isBusy: false,
            imageFile: null
        },

        setState(s) {
            Object.assign(this.state, s);
            UIManager.updateView(this.state);
            if (s.reviews !== undefined) UIManager.renderReviews(this.state.reviews, this.state.token);
        },

        async withLoading(fn) {
            if (this.state.isBusy) return;
            this.setState({ isBusy: true });
            try {
                await fn();
            } catch (err) {
                console.error(err);
                UIManager.showToast(err.message, true);
            } finally {
                this.setState({ isBusy: false });
            }
        },

        // NEW HELPER: Reads a file with progress updates
        _readFileWithProgress(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = () => reject(new Error("Failed to read file."));
                reader.onprogress = (event) => {
                    if (event.lengthComputable) {
                        UIManager.imageProgress.value = Math.round((event.loaded / event.total) * 100);
                    }
                };
                reader.readAsDataURL(file);
            });
        },
        
        async init() {
            UIManager.populateRatingSelectors();
            if (this.state.token) {
                await this.withLoading(async () => {
                    const reviews = await ApiService.fetchReviews(this.state.token);
                    this.setState({ reviews });
                }).catch(() => this.setState({ token: null }));
            } else {
                 this.setState({ token: null });
            }
            this.bindEvents();
        },

        bindEvents() {
            UIManager.loginForm.addEventListener("submit", e => {
                e.preventDefault();
                UIManager.loginLoading.classList.remove("hidden");
                UIManager.loginError.classList.add("hidden");
                this.withLoading(async () => {
                    const token = await ApiService.getPat(UIManager.loginPassword.value);
                    sessionStorage.setItem('github_pat', token);
                    const reviews = await ApiService.fetchReviews(token);
                    this.setState({ token, reviews, activeTab: 'read' });
                }).catch(err => {
                    UIManager.loginError.textContent = err.message;
                    UIManager.loginError.classList.remove("hidden");
                }).finally(() => {
                    UIManager.loginLoading.classList.add("hidden");
                });
            });

            UIManager.logoutBtn.addEventListener("click", () => {
                sessionStorage.removeItem('github_pat');
                this.setState({ token: null, reviews: [] });
            });

// ... inside bindEvents() ...

            UIManager.reviewForm.addEventListener("submit", e => {
                e.preventDefault();
                this.withLoading(async () => {
                    const form = e.target;
                    const newReview = Object.fromEntries(new FormData(form));
                    newReview.timestamp = new Date().toISOString();
                    const file = this.state.imageFile;
            
                    // ✅ ADDED A DEDICATED TRY/CATCH FOR IMAGE HANDLING
                    if (file) {
                        try {
                            UIManager.showToast("Compressing & uploading image...");
                            const compressedFile = await ApiService._compressImage(file);
                            if (!compressedFile) {
                                // This will stop execution if compression returns nothing
                                throw new Error("Image compression failed silently.");
                            }
                            newReview.image = await ApiService.uploadImage(compressedFile, this.state.token);
                        } catch (imageError) {
                            // This will now catch the specific error and show it to you
                            console.error("Image processing failed:", imageError);
                            UIManager.showToast(`Image Error: ${imageError.message}`, true);
                            // Return here to stop the review from being saved without the image
                            return; 
                        }
                    }
                    
                    const updated = [...this.state.reviews, newReview];
                    await ApiService.saveReviews(updated, this.state.token);
                    this.setState({ reviews: updated, activeTab: 'read', imageFile: null });
                    UIManager.resetForm();
                    UIManager.showToast("Review added successfully!");
                });
            });



            UIManager.reviewsList.addEventListener('click', e => {
                if (e.target.dataset.action !== 'delete' || !confirm("Delete this review?")) return;
                this.withLoading(async () => {
                    const index = parseInt(e.target.closest('[data-index]').dataset.index, 10);
                    const updated = this.state.reviews.filter((_, i) => i !== index);
                    await ApiService.saveReviews(updated, this.state.token);
                    this.setState({ reviews: updated });
                    UIManager.showToast("Review deleted successfully!");
                });
            });

            // REFACTORED: Event listener for image upload
UIManager.imageUpload.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    
    const cleanUp = () => {
        this.setState({ imageFile: null });
        UIManager.imagePreview.src = '';
        UIManager.imagePreview.classList.add('hidden');
        UIManager.imageProgress.classList.add('hidden');
        e.target.value = ''; // Reset input
    };

    if (!file) return cleanUp();

    // More restrictive checks for mobile
    if (!file.type.startsWith('image/')) {
        UIManager.showToast("Please select a valid image file.", true);
        return cleanUp();
    }
    
    // Reduced size limit for mobile compatibility
    if (file.size > 10 * 1024 * 1024) { // 10MB limit instead of 15MB
        UIManager.showToast("Image file too large (max 10MB).", true);
        return cleanUp();
    }
    
    // Check if we're likely on a mobile device
    const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) 
                     || window.innerWidth < 768;
    
    if (isMobile && file.size > 5 * 1024 * 1024) { // 5MB limit for mobile
        UIManager.showToast("Image file too large for mobile (max 5MB).", true);
        return cleanUp();
    }
    
    await this.withLoading(async () => {
        try {
            this.setState({ imageFile: file });
            UIManager.imageProgress.classList.remove('hidden');
            UIManager.imageProgress.value = 0;
            UIManager.imagePreview.classList.add('loading');
            UIManager.imagePreview.classList.remove('hidden');

            // Add a small delay to ensure UI updates on mobile
            await new Promise(resolve => setTimeout(resolve, 50));
            
            const dataUrl = await this._readFileWithProgress(file);
            
            // Validate the data URL
            if (!dataUrl || !dataUrl.startsWith('data:image/')) {
                throw new Error('Invalid image data');
            }
            
            UIManager.imagePreview.src = dataUrl;
            UIManager.imagePreview.onload = () => {
                UIManager.imagePreview.classList.remove('loading');
                UIManager.imageProgress.classList.add('hidden');
            };
            
        } catch (error) {
            console.error('Image processing error:', error);
            UIManager.showToast(`Image processing failed: ${error.message}`, true);
            cleanUp();
        }
    });
});

    AppController.init();
});
