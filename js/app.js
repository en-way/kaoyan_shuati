/**
 * 向后兼容入口转发层 (js/app.js -> js/main.js)
 * 供任何旧书签或缓存脚本无缝加载模块化主入口。
 */
export { App, DB, KY_CONFIG, KyApi } from './main.js';
