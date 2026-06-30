/**
 * 项目内工具函数，可在这里添加
 */

// 示例：获取localStorage
export const getLocalStorage = <T = any>(key: string, defaultValue?: T): T | null => {
  try {
    const value = localStorage.getItem(key);
    if (value === null) {
      return defaultValue ?? null;
    }
    return JSON.parse(value) as T;
  } catch (error) {
    console.error(`读取localStorage ${key} 失败:`, error);
    return defaultValue ?? null;
  }
};

// 示例：设置localStorage
export const setLocalStorage = <T = any>(key: string, value: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`写入localStorage ${key} 失败:`, error);
  }
};