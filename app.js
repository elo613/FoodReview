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
            const metaRes = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' }
            });
            if (metaRes.ok) {
                const meta = await metaRes.json();
                sha = meta.sha;
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
            if (!res.ok) throw new Error(`Failed to save reviews: ${res.status}`);
            return await res.json();
        },

        async uploadImage(file, token) {
            const sanitized = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
            const timestamp = Date.now();
            const fileName = `images/${timestamp}_${sanitized}`;
            const url = this._getApiUrl(fileName);
            const base64Content = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            const body = { message: `Upload image ${file.name}`, content: base64Content };
            const res = await fetch(url, {
                method: 'PUT',
                headers: { 
                    'Authorization': `Bearer ${token}`, 
                    'Accept': 'application/vnd.github.v3+json' 
                },
                body: JSON.stringify(body)
            });
            if (!res.ok) throw new Error(`Image upload failed: ${res.status}`);
            return fileName;
        },

        async fetchImageAsBlobUrl(path, token) {
            const url = this._getRawUrl(path);
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) {
                console.error("Failed to fetch image:", path);
                return null;
            }
            const imageBlob = await res.blob();
            return URL.createObjectURL(imageBlob);
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
        toast: document.getElementById("toast"),

        showToast(msg, error = false) {
            this.toast.textContent = msg;
            this.toast.className = `fixed bottom-5 right-5 px-4 py-2 rounded-lg shadow-xl transition-all transform ${error ? 'bg-red-600' : 'bg-green-600'}`;
            this.toast.classList.remove("opacity-0", "translate-y-4");
            setTimeout(() => this.toast.classList.add("opacity-0", "translate-y-4"), 3000);
        },

        updateView({ token, activeTab, isBusy }) {
            this.app.classList.toggle('hidden', !token);
            this.loginScreen.classList.toggle('hidden', !!token);
            const isAdd = activeTab === 'add';
            this.addTab.classList.toggle('tab-active', isAdd);
            this.readTab.classList.toggle('tab-active', !isAdd);
            this.addReviewContent.classList.toggle('hidden', !isAdd);
            this.readReviewsContent.classList.toggle('hidden', isAdd);
            this.reviewForm.querySelector('button').disabled = isBusy;
        },

        resetForm() {
            this.reviewForm.reset();
            this.imagePreview.src = '';
            this.imagePreview.classList.add('hidden');
        },

        _createReviewHTML(r, i) {
            const { restaurant, foodItem, price, taste, texture, size, value, EL, AG, timestamp, image } = r;
            const date = new Date(timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            const imageHtml = image ? `<img data-image-path="${image}" class="mb-3 max-h-72 w-full object-cover rounded-md bg-gray-200">` : '';

            return `<div class="p-4 border border-gray-200 rounded-lg bg-white flex flex-col" data-index="${i}">
                ${imageHtml}
                <div class="flex-grow">
                    <div class="flex justify-between items-start gap-4">
                        <div>
                            <h3 class="text-xl font-bold text-blue-600">${restaurant}</h3>
                            <p class="text-gray-700">${foodItem} - £${price}</p>
                        </div>
                        <button class="font-semibold text-sm text-red-500 hover:text-red-700 flex-shrink-0" data-action="delete">Delete</button>
                    </div>
                    <div class="mt-2 pt-2 border-t grid grid-cols-2 sm:grid-cols-6 gap-2 text-sm text-gray-600">
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
            const imagesToLoad = this.reviewsList.querySelectorAll('img[data-image-path]');
            if (token) {
                imagesToLoad.forEach(img => {
                    const path = img.dataset.imagePath;
                    ApiService.fetchImageAsBlobUrl(path, token).then(blobUrl => {
                        if (blobUrl) {
                            img.src = blobUrl;
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
                const select = document.getElementById(id);
                select.innerHTML = `<option value="Yes">Yes</option><option value="No">No</option>`;
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
                throw err;
            } finally {
                this.setState({ isBusy: false });
            }
        },

        async init() {
            UIManager.populateRatingSelectors();
            if (this.state.token && ApiService._isValidGitHubToken(this.state.token)) {
                await this.withLoading(async () => {
                    const reviews = await ApiService.fetchReviews(this.state.token);
                    this.setState({ reviews });
                }).catch(() => {
                    sessionStorage.removeItem('github_pat');
                    this.setState({ token: null });
                });
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

            UIManager.reviewForm.addEventListener("submit", e => {
                e.preventDefault();
                this.withLoading(async () => {
                    const form = e.target;
                    const newReview = Object.fromEntries(new FormData(form));
                    newReview.price = parseFloat(newReview.price).toFixed(2);
                    newReview.timestamp = new Date().toISOString();
                    const file = this.state.imageFile;
                    if (file) newReview.image = await ApiService.uploadImage(file, this.state.token);
                    else newReview.image = '';
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

            UIManager.imageUpload.addEventListener("change", e => {
                const file = e.target.files[0];
                this.setState({ imageFile: file || null });
                if (file) {
                    const reader = new FileReader();
                    reader.onload = ev => {
                        UIManager.imagePreview.src = ev.target.result;
                        UIManager.imagePreview.classList.remove('hidden');
                    };
                    reader.readAsDataURL(file);
                } else {
                    UIManager.imagePreview.src = '';
                    UIManager.imagePreview.classList.add('hidden');
                }
            });

            UIManager.addTab.addEventListener("click", () => this.setState({ activeTab: 'add' }));
            UIManager.readTab.addEventListener("click", () => this.setState({ activeTab: 'read' }));
        }
    };

    AppController.init();
});
