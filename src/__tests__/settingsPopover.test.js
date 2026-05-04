import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getState, getModelType, resolveModelToFamily, getModelId, selectFamilyRatioResolution, MODEL_FAMILIES, supportsAspectRatioSelection } from '../store.js';

// Mock fetch 和 localStorage
global.fetch = vi.fn();
global.localStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};

describe('simpleMode 移除验证', () => {
  it('simpleMode 不应存在于 store 初始状态中', () => {
    const state = getState();
    expect(state.simpleMode).toBeUndefined();
  });
});

describe('getModelType - 模型类型检测', () => {
  it('应检测 gpt 类型', () => {
    expect(getModelType('gpt-image-2')).toBe('gpt');
  });

  it('应检测 gemini 类型', () => {
    expect(getModelType('gemini-3.0-pro-image-square')).toBe('gemini');
    expect(getModelType('gemini-3.1-flash-image-portrait-2k')).toBe('gemini');
  });

  it('应检测 imagen 类型', () => {
    expect(getModelType('imagen-4.0-generate-preview-portrait')).toBe('imagen');
    expect(getModelType('imagen-4.0-generate-preview-landscape')).toBe('imagen');
  });

  it('未知模型应返回 null', () => {
    expect(getModelType('some-unknown-model')).toBeNull();
  });

  it('空值应返回 null', () => {
    expect(getModelType('')).toBeNull();
    expect(getModelType(null)).toBeNull();
    expect(getModelType(undefined)).toBeNull();
  });
});

describe('supportsAspectRatioSelection - 比例选择能力判断', () => {
  it('仅对 gpt-image 模型启用比例选择（同一模型支持多种比例）', () => {
    expect(supportsAspectRatioSelection('gpt-image-2')).toBe(true);
  });

  it('gemini/imagen 模型比例已编码在模型名中，不启用比例选择', () => {
    expect(supportsAspectRatioSelection('gemini-3.0-pro-image-square')).toBe(false);
    expect(supportsAspectRatioSelection('imagen-4.0-generate-preview-landscape')).toBe(false);
  });

  it('应对普通或未知模型禁用比例选择', () => {
    expect(supportsAspectRatioSelection('claude-sonnet-4-6')).toBe(false);
    expect(supportsAspectRatioSelection('some-unknown-model')).toBe(false);
    expect(supportsAspectRatioSelection('')).toBe(false);
  });
});

describe('resolveModelToFamily - 反向解析 Model ID', () => {
  it('应正确解析 gpt-image-2', () => {
    const result = resolveModelToFamily('gpt-image-2');
    expect(result).not.toBeNull();
    expect(result.familyId).toBe('gpt-image');
    expect(result.ratio).toBe('1:1');
    expect(result.resolution).toBe('1K');
  });

  it('无法从同一 GPT 模型 ID 唯一反推用户选择的比例', () => {
    expect(getModelId('gpt-image', '16:9', '1K')).toBe('gpt-image-2');
    expect(getModelId('gpt-image', '3:4', '1K')).toBe('gpt-image-2');
  });

  it('应正确解析 gemini 1K 模型（无分辨率后缀）', () => {
    const result = resolveModelToFamily('gemini-3.0-pro-image-square');
    expect(result).not.toBeNull();
    expect(result.familyId).toBe('gemini-3.0-pro-image');
    expect(result.ratio).toBe('1:1');
    expect(result.resolution).toBe('1K');
  });

  it('应正确解析 gemini 2K 模型', () => {
    const result = resolveModelToFamily('gemini-3.0-pro-image-portrait-2k');
    expect(result).not.toBeNull();
    expect(result.familyId).toBe('gemini-3.0-pro-image');
    expect(result.ratio).toBe('9:16');
    expect(result.resolution).toBe('2K');
  });

  it('应正确解析 gemini 4K 模型', () => {
    const result = resolveModelToFamily('gemini-3.1-flash-image-landscape-4k');
    expect(result).not.toBeNull();
    expect(result.familyId).toBe('gemini-3.1-flash-image');
    expect(result.ratio).toBe('16:9');
    expect(result.resolution).toBe('4K');
  });

  it('应正确解析 imagen portrait', () => {
    const result = resolveModelToFamily('imagen-4.0-generate-preview-portrait');
    expect(result).not.toBeNull();
    expect(result.familyId).toBe('imagen-4.0');
    expect(result.ratio).toBe('9:16');
    expect(result.resolution).toBe('Preview');
  });

  it('应正确解析 imagen landscape', () => {
    const result = resolveModelToFamily('imagen-4.0-generate-preview-landscape');
    expect(result).not.toBeNull();
    expect(result.familyId).toBe('imagen-4.0');
    expect(result.ratio).toBe('16:9');
    expect(result.resolution).toBe('Preview');
  });

  it('未知模型应返回 null', () => {
    expect(resolveModelToFamily('nonexistent-model')).toBeNull();
  });

  it('空值应返回 null', () => {
    expect(resolveModelToFamily('')).toBeNull();
    expect(resolveModelToFamily(null)).toBeNull();
  });
});

describe('模型 ID 构建与更新', () => {
  it('GPT 模型所有比例都返回 gpt-image-2', () => {
    expect(getModelId('gpt-image', '16:9', '1K')).toBe('gpt-image-2');
    expect(getModelId('gpt-image', '1:1', '1K')).toBe('gpt-image-2');
    expect(getModelId('gpt-image', '9:16', '1K')).toBe('gpt-image-2');
  });

  it('Gemini 比例切换应生成正确的新 model ID', () => {
    // 从 square 切换到 portrait
    expect(getModelId('gemini-3.0-pro-image', '9:16', '1K')).toBe('gemini-3.0-pro-image-portrait');
    // 从 square 切换到 landscape
    expect(getModelId('gemini-3.0-pro-image', '16:9', '1K')).toBe('gemini-3.0-pro-image-landscape');
  });

  it('Gemini 分辨率切换应生成正确的新 model ID', () => {
    expect(getModelId('gemini-3.0-pro-image', '1:1', '2K')).toBe('gemini-3.0-pro-image-square-2k');
    expect(getModelId('gemini-3.0-pro-image', '1:1', '4K')).toBe('gemini-3.0-pro-image-square-4k');
  });

  it('Imagen 比例切换应生成正确的新 model ID', () => {
    expect(getModelId('imagen-4.0', '9:16', 'Preview')).toBe('imagen-4.0-generate-preview-portrait');
    expect(getModelId('imagen-4.0', '16:9', 'Preview')).toBe('imagen-4.0-generate-preview-landscape');
  });
});

describe('MODEL_FAMILIES 结构验证', () => {
  it('GPT 系列应有 5 种比例且仅有 1K 分辨率', () => {
    const gpt = MODEL_FAMILIES.find(f => f.id === 'gpt-image');
    const ratioKeys = Object.keys(gpt.ratios);
    expect(ratioKeys).toHaveLength(5);
    ratioKeys.forEach(ratio => {
      expect(gpt.ratios[ratio]).toEqual(['1K']);
    });
  });

  it('Gemini 系列应有 5 种比例且支持 1K/2K/4K', () => {
    const gemini = MODEL_FAMILIES.find(f => f.id === 'gemini-3.0-pro-image');
    const ratioKeys = Object.keys(gemini.ratios);
    expect(ratioKeys).toHaveLength(5);
    ratioKeys.forEach(ratio => {
      expect(gemini.ratios[ratio]).toEqual(['1K', '2K', '4K']);
    });
  });

  it('Imagen 系列应仅有 2 种比例且仅有 Preview 分辨率', () => {
    const imagen = MODEL_FAMILIES.find(f => f.id === 'imagen-4.0');
    const ratioKeys = Object.keys(imagen.ratios);
    expect(ratioKeys).toEqual(['9:16', '16:9']);
    ratioKeys.forEach(ratio => {
      expect(imagen.ratios[ratio]).toEqual(['Preview']);
    });
  });
});
