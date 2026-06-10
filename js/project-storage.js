const ProjectStorage = (function () {
    const DB_NAME = 'school15_projects_db';
    const STORE = 'files';
    const META_KEY = 'school15_projects';
    const DB_VERSION = 15;
    
    // ImgBB API ключ (для обложек)
    const IMGBB_API_KEY = '6c882c5f0e4e93d6f9975e96a2207d8e';
    
    // Яндекс.Диск настройки
    const YANDEX_CLIENT_ID = 'dd9f55703e4f4349b9294cb031ac83c7';
    const REDIRECT_URI = window.location.origin + window.location.pathname;
    
    let yandexToken = null;
    
    // === YANDEX DISK ===
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
        
        const safeName = file.name.replace(/[^a-zA-Zа-яА-Я0-9._-]/g, '_');
        const fileName = `${Date.now()}_${safeName}`;
        const path = `${folder}/${fileName}`;
        
        const uploadResponse = await fetch(`https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(path)}&overwrite=true`, {
            method: 'GET',
            headers: { 'Authorization': `OAuth ${token}` }
        });
        
        if (!uploadResponse.ok) {
            throw new Error(`Ошибка получения ссылки: ${uploadResponse.status}`);
        }
        
        const uploadData = await uploadResponse.json();
        
        await fetch(uploadData.href, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': file.type || 'application/octet-stream' }
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
            storage: 'yandex'
        };
    }
    
    // === IMGBB ДЛЯ ОБЛОЖЕК ===
    async function uploadToImgBB(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const base64 = e.target.result.split(',')[1];
                const formData = new FormData();
                formData.append('image', base64);
                formData.append('key', IMGBB_API_KEY);
                
                try {
                    const response = await fetch('https://api.imgbb.com/1/upload', {
                        method: 'POST',
                        body: formData
                    });
                    const data = await response.json();
                    if (data.success) {
                        resolve(data.data.url);
                    } else {
                        reject(new Error('Ошибка загрузки обложки'));
                    }
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(new Error('Ошибка чтения файла'));
            reader.readAsDataURL(file);
        });
    }
    
    // === INDEXEDDB ===
    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE, { keyPath: 'key' });
                }
            };
        });
    }
    
    function key(id, name) {
        return `${id}|${name}`;
    }
    
    async function saveFileRecord(projectId, fileData) {
        const db = await openDB();
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        
        return new Promise((resolve, reject) => {
            const req = store.put({
                key: key(projectId, fileData.name),
                projectId: projectId,
                ...fileData
            });
            req.onerror = () => reject(req.error);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
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
    
    // === МЕТАДАННЫЕ ПРОЕКТОВ (localStorage) ===
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
    
    // === ОСНОВНАЯ ФУНКЦИЯ СОХРАНЕНИЯ ПРОЕКТА ===
    async function saveProjectFolder(projectId, fileList, thumbFile = null) {
        const files = Array.from(fileList);
        if (!files.length) throw new Error('Нет файлов');
        
        // 1. Загружаем обложку на ImgBB (если есть)
        let thumbUrl = null;
        if (thumbFile) {
            try {
                thumbUrl = await uploadToImgBB(thumbFile);
                console.log('Обложка загружена на ImgBB:', thumbUrl);
            } catch (err) {
                console.warn('Не удалось загрузить обложку:', err);
            }
        }
        
        // 2. Загружаем ВСЕ файлы проекта на Яндекс.Диск (даже маленькие)
        for (const file of files) {
            try {
                const yandexRef = await uploadToYandex(file);
                await saveFileRecord(projectId, {
                    name: file.name,
                    size: file.size,
                    storage: 'yandex',
                    url: yandexRef.url,
                    path: yandexRef.path
                });
                console.log(`Файл ${file.name} загружен на Яндекс.Диск`);
            } catch (err) {
                console.error(`Ошибка загрузки ${file.name}:`, err);
                throw new Error(`Не удалось загрузить ${file.name} на Яндекс.Диск: ${err.message}`);
            }
        }
        
        return { fileCount: files.length, thumbUrl: thumbUrl };
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
        // Удаляем записи из IndexedDB
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
        
        // Удаляем метаданные
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
