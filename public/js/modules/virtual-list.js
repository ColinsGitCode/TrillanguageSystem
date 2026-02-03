/**
 * 虚拟列表实现
 * 用于渲染大量数据而不阻塞 DOM
 */

export class VirtualList {
    constructor(container, options = {}) {
        this.container = container;
        this.options = {
            itemHeight: 36, // 默认行高
            buffer: 5,      // 上下缓冲数量
            renderItem: null, // 渲染回调 (index, data) => HTMLElement
            ...options
        };
        
        this.items = [];
        this.scroller = null;
        this.content = null;
        this.visibleItems = new Map(); // index -> element
        
        this.init();
    }

    init() {
        // 创建滚动容器和内容容器
        this.container.style.overflowY = 'auto';
        this.container.style.position = 'relative';
        
        this.content = document.createElement('div');
        this.content.style.position = 'absolute';
        this.content.style.top = '0';
        this.content.style.left = '0';
        this.content.style.width = '100%';
        this.container.appendChild(this.content);

        this.container.addEventListener('scroll', () => this.onScroll());
    }

    setData(items) {
        this.items = items;
        // 设置总高度
        this.content.style.height = `${this.items.length * this.options.itemHeight}px`;
        this.onScroll(true); // 强制刷新
    }

    onScroll(force = false) {
        const scrollTop = this.container.scrollTop;
        const viewportHeight = this.container.clientHeight;
        
        const startIndex = Math.floor(scrollTop / this.options.itemHeight);
        const endIndex = Math.min(
            this.items.length - 1,
            Math.floor((scrollTop + viewportHeight) / this.options.itemHeight)
        );

        // 计算带缓冲的渲染范围
        const renderStart = Math.max(0, startIndex - this.options.buffer);
        const renderEnd = Math.min(this.items.length - 1, endIndex + this.options.buffer);

        // 移除范围外的元素
        for (const [index, el] of this.visibleItems) {
            if (index < renderStart || index > renderEnd || force) {
                if (el.parentNode) el.parentNode.removeChild(el);
                this.visibleItems.delete(index);
            }
        }

        // 添加范围内的新元素
        for (let i = renderStart; i <= renderEnd; i++) {
            if (!this.visibleItems.has(i)) {
                const itemData = this.items[i];
                const el = this.options.renderItem(i, itemData);
                if (el) {
                    el.style.position = 'absolute';
                    el.style.top = `${i * this.options.itemHeight}px`;
                    el.style.width = '100%';
                    el.style.height = `${this.options.itemHeight}px`;
                    this.content.appendChild(el);
                    this.visibleItems.set(i, el);
                }
            }
        }
    }
    
    // 清空列表
    clear() {
        this.items = [];
        this.content.innerHTML = '';
        this.content.style.height = '0px';
        this.visibleItems.clear();
    }
}
