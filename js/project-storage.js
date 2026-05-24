const ProjectStorage = (function () {
    const DB_NAME = 'school15_projects_db';
    const STORE = 'files';
    const META_KEY = 'school15_projects';
    const DB_VERSION = 10;

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
        
        for (const file of files) {
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
                    data
                });
                req.onerror = () => reject(req.error);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        }
        
        return { fileCount: files.length };
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
        if (!record || !record.data) {
            alert('Файл не найден');
            return;
        }
        const blob = new Blob([record.data], { type: record.type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = record.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 500);
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

    return {
        getProjects,
        saveProjects,
        saveProjectFolder,
        listProjectFiles,
        getFileRecord,
        downloadRecord,
        approveProject,
        deleteProject,
        formatSize
    };
})();
