/**
 * 状态管理模块
 * 简单的 Pub/Sub 实现
 */

class Store {
    constructor() {
        this.state = {
            folders: [],
            files: [],
            selectedFolder: null,
            selectedFile: null,
            selectedFileTitle: null,
            imageBase64: null,
            isGenerating: false,
            llmProvider: localStorage.getItem('llm_provider') || 'local',
            
            // 历史记录相关
            history: {
                records: [],
                currentPage: 1,
                pageSize: 20,
                totalPages: 1,
                totalCount: 0,
                searchQuery: '',
                providerFilter: '',
                loaded: false
            }
        };
        
        this.listeners = new Map();
    }

    /**
     * 获取状态快照
     */
    get(key) {
        if (key) return this.state[key];
        return { ...this.state };
    }

    /**
     * 更新状态并通知订阅者
     * @param {Object} partialState 部分状态对象
     */
    setState(partialState) {
        // 深度合并简化版 (仅支持顶层和一层的对象)
        Object.keys(partialState).forEach(key => {
            if (typeof partialState[key] === 'object' && partialState[key] !== null && !Array.isArray(partialState[key])) {
                this.state[key] = { ...this.state[key], ...partialState[key] };
            } else {
                this.state[key] = partialState[key];
            }
        });

        // 触发订阅
        this.listeners.forEach((callback, key) => {
            // 这里可以做更精细的 diff，但简单场景下全部通知即可
            callback(this.state);
        });
    }

    /**
     * 订阅状态变化
     * @param {string} key 订阅者标识
     * @param {Function} callback 回调函数
     */
    subscribe(key, callback) {
        this.listeners.set(key, callback);
    }

    unsubscribe(key) {
        this.listeners.delete(key);
    }
}

export const store = new Store();
