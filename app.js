document.addEventListener("DOMContentLoaded", () => {

const GITHUB_OWNER = "elo613";
const GITHUB_REPO = "FoodReview";
const REVIEWS_FILE_PATH = "reviews.json";
const PAT_FILE = "pat.enc.json";

// --- ApiService ---
const ApiService = {
  _getApiUrl: path => `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(path)}`,
  _getRawUrl: path => `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/${encodeURIComponent(path)}`,
  _xorCipher: (str, key) => str.split('').map((c,i) => String.fromCharCode(c.charCodeAt(0)^key.charCodeAt(i%key.length))).join(''),
  _decryptPat: (data,key) => ApiService._xorCipher(atob(data), key).trim(),
  _isValidGitHubToken: token => token && typeof token==='string' && ['ghp_','gho_','ghu_','ghs_','ghr_','github_pat_'].some(p=>token.startsWith(p)) && token.length>=40,
  
  async getPat(password){
    const res = await fetch(`${this._getRawUrl(PAT_FILE)}?t=${Date.now()}`);
    if(!res.ok) throw new Error("Could not fetch PAT file.");
    const {data} = await res.json();
    const token = this._decryptPat(data,password);
    if(!this._isValidGitHubToken(token)) throw new Error("Incorrect password or token decryption failed.");
    return token;
  },

  async fetchReviews(){
    const res = await fetch(`${this._getRawUrl(REVIEWS_FILE_PATH)}?t=${Date.now()}`);
    if(res.status===404) return [];
    if(!res.ok) throw new Error("Failed to fetch reviews");
    return await res.json();
  },

  async saveReviews(reviews, token){
    const url = this._getApiUrl(REVIEWS_FILE_PATH);
    let sha = null;
    const metaRes = await fetch(url, { headers: {'Authorization': `Bearer ${token}`, 'Accept':'application/vnd.github.v3+json'} });
    if(metaRes.ok) { const meta = await metaRes.json(); sha
