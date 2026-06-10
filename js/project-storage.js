const ProjectStorage = (function () {
    const DB_NAME = 'school15_projects_db';
    const STORE = 'files';
    const META_KEY = 'school15_projects';
    const DB_VERSION = 12;
    
    // НОВЫЙ Client ID
    const YANDEX_CLIENT_ID = 'fdad13236d574a14b044237d9308aab3';
    const REDIRECT_URI = window.location.origin + window.location.pathname;
    
    let yandexToken = null;
    
    function getYandexToken() {
        if (yandexToken) return yandexToken;
        const hash = window.location.hash;
        const params = new URLSearchParams(hash.replace('#', '?'));
        const token = params.get('access_token');
        if (token) {
            sessionStorage.setItem('yandex_projects_token', token);
            window.history.replaceState({}, document.title, window.location.pathname);
            yandexToken = token;
            return token;
        }
        yandexToken = sessionStorage.getItem('yandex_projects_token');
        return yandexToken;
    }
    
    function redirectToYandexAuth() {
        const authUrl = `https://oauth.yandex.ru/authorize?response_type=token&client_id=${YANDEX_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
        window.location.href = authUrl;
    }
    
    async function uploadToYandex(file, folder = '/school_projects') {
        const token = getYandexToken();
        if (!token) {
            redirectToYandexAuth();
            throw new Error('Требуется авторизация в Яндексе');
        }
        
        const fileName = `${Date.now()}_${file.name}`;
        const path = `${folder}/${fileName}`;
        
        const uploadResponse = await fetch(`https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(path)}&overwrite=true`, {
            method: 'GET',
            headers: { 'Authorization': `OAuth ${token}` }
        });
        const uploadData = await uploadResponse.json();
        
        await fetch(uploadData.href, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': file.type }
        });
        
        const publishResponse = await fetch(`https://cloud-api.yandex.net/v1/disk/resources/publish?path=${encodeURIComponent(path)}`, {
            method: 'PUT',
            headers: { 'Authorization': `OAuth ${token}` }
        });
        const publishData = await publishResponse.json();
        
        return {
            url: publishData.href,
            name: file.name,
            size: file.size,
            path: path,
            type: 'yandex'
        };
    }
    
    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (db.objectStoreNames.contains(STORE)) {
                    db.deleteObjectStore(STORE);
                }
                db.createObjectStore(STORE, { keyPath: 'key' });
            };
        });
    }
    
    function key(id, name) {
        return `${id}|${name}`;
    }
    
    function getProjects() {
        try {
            return JSON.parse(localStorage.getItem(META_KEY) || '[]');
        } catch (e) {
            return [];
        }
    }
    
    function saveProjects(list) {
        localStorage.setItem(META_KEY, JSON.stringify(list));
    }
    
    async function saveProjectFolder(projectId, fileList) {
        const files = Array.from(fileList);
        if (!files.length) throw new Error('Нет файлов');
        
        const db = await openDB();
        const yandexFiles = [];
        const localFiles = [];
        
        for (const file of files) {
            if (file.size > 1024 * 1024) {
                try {
                    const yandexRef = await uploadToYandex(file);
                    yandexFiles.push(yandexRef);
                } catch (err) {
                    console.error('Ошибка загрузки на Яндекс:', err);
                    throw new Error(`Не удалось загрузить ${file.name} на Яндекс.Диск`);
                }
            } else {
                localFiles.push(file);
            }
        }
        
        for (const file of localFiles) {
            const data = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.readAsArrayBuffer(file);
            });
            
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            
            await new Promise((resolve, reject) => {
                const req = store.put({
                    key: key(projectId, file.name),
                    projectId,
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    data,
                    storage: 'indexeddb'
                });
                req.onerror = () => reject(req.error);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        }
        
        for (const yf of yandexFiles) {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            
            await new Promise((resolve, reject) => {
                const req = store.put({
                    key: key(projectId, yf.name),
                    projectId,
                    name: yf.name,
                    size: yf.size,
                    url: yf.url,
                    storage: 'yandex',
                    path: yf.path
                });
                req.onerror = () => reject(req.error);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        }
        
        return { fileCount: files.length, yandexCount: yandexFiles.length, localCount: localFiles.length };
    }
    
    async function listProjectFiles(projectId) {
        const db = await openDB();
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        
        const all = await new Promise((resolve) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
        });
        
        return all.filter(r => r.projectId === projectId);
    }
    
    async function getFileRecord(projectId, fileName) {
        const db = await openDB();
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        
        return new Promise((resolve) => {
            const req = store.get(key(projectId, fileName));
            req.onsuccess = () => resolve(req.result);
        });
    }
    
    function downloadRecord(record) {
        if (!record) {
            alert('Файл не найден');
            return;
        }
        
        if (record.storage === 'yandex' && record.url) {
            window.open(record.url, '_blank');
            return;
        }
        
        if (record.data) {
            const blob = new Blob([record.data], { type: record.type });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = record.name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 500);
        } else {
            alert('Данные файла не найдены');
        }
    }
    
    async function approveProject(projectId) {
        const projects = getProjects();
        const index = projects.findIndex(p => p.id === projectId);
        if (index !== -1) {
            projects[index].status = 'approved';
            saveProjects(projects);
        }
    }
    
    async function deleteProject(projectId) {
        const files = await listProjectFiles(projectId);
        const db = await openDB();
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        
        for (const file of files) {
            store.delete(key(projectId, file.name));
        }
        
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        
        const projects = getProjects().filter(p => p.id !== projectId);
        saveProjects(projects);
    }
    
    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' Б';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
        return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
    }
    
    function isYandexAuthorized() {
        return !!getYandexToken();
    }
    
    return {
        getProjects,
        saveProjects,
        saveProjectFolder,
        listProjectFiles,
        getFileRecord,
        downloadRecord,
        approveProject,
        deleteProject,
        formatSize,
        isYandexAuthorized,
        redirectToYandexAuth
    };
})();
