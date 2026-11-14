// 展示用工具（WXML 表达式不支持函数调用，需在 JS 侧预计算好文案）
function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    var units = ['KB', 'MB', 'GB', 'TB'];
    var i = -1;
    var v = n;
    do {
        v = v / 1024;
        i++;
    } while (v >= 1024 && i < units.length - 1);
    var digits = v >= 100 ? 0 : 1;
    return v.toFixed(digits) + ' ' + units[i];
}

function isImage(name) {
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name || '');
}

// 取展示用时间戳字段（优先常见命名）
function pickTime(doc) {
    if (!doc) return '';
    var keys = ['updatedAt', 'updated_at', 'createdAt', 'created_at', 'createTime', 'time', 'ts'];
    for (var i = 0; i < keys.length; i++) {
        var v = doc[keys[i]];
        if (v != null && v !== '') return typeof v === 'number' ? new Date(v * (v < 1e12 ? 1000 : 1)).toLocaleString() : String(v);
    }
    return '';
}

// 生成文档预览：优先展示前几个字段，避免整包太长
function docPreview(doc) {
    try {
        var s = JSON.stringify(doc);
        if (s.length > 120) return s.slice(0, 120) + '…';
        return s;
    } catch (e) {
        return '[无法解析]';
    }
}

module.exports = {
    formatBytes: formatBytes,
    isImage: isImage,
    pickTime: pickTime,
    docPreview: docPreview
};
