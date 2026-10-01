import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  deleteCampReportThemeConfig,
  loadCampReportThemeConfigs,
  type CampReportThemeConfig,
  upsertCampReportThemeConfig,
} from '../utils/campReportStorage';
import {
  buildCampThemeVars,
  CAMP_THEME_UPDATED_EVENT,
  createPaletteFromAccent,
  extractDominantColorFromImage,
  getDefaultCampTheme,
  normalizePalette,
  type CampReportPalette,
} from '../utils/campReportTheme';
import { CAMP_MAJOR_OPTIONS, getMajorCampName, type CampMajorLevel } from '../data/campReportCatalog';
import './SummerCampThemeManager.css';

const THEME_COLOR_FIELDS: Array<{ key: keyof CampReportPalette; label: string }> = [
  { key: 'accent', label: '主色' },
  { key: 'accentStrong', label: '深主色' },
  { key: 'accentSoft', label: '浅底色' },
  { key: 'paper', label: '页面底色' },
  { key: 'moduleWarm', label: '模块色 A' },
  { key: 'moduleCool', label: '模块色 B' },
  { key: 'border', label: '边框色' },
  { key: 'ink', label: '文字色' },
  { key: 'highlight', label: '强调色' },
];

interface Props {
  defaultMajorCamp?: CampMajorLevel;
  compact?: boolean;
  onThemeChange?: () => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败。'));
    reader.readAsDataURL(file);
  });
}

function getSourceLabel(source: CampReportThemeConfig['source']) {
  if (source === 'logo') return 'Logo 自动识别';
  if (source === 'image') return '参考图自动识别';
  if (source === 'manual') return '人工调整';
  return '默认预设';
}

function emitThemeUpdated(majorCamp: CampMajorLevel) {
  window.dispatchEvent(new CustomEvent(CAMP_THEME_UPDATED_EVENT, { detail: { majorCamp } }));
}

export default function SummerCampThemeManager({ defaultMajorCamp = 'L2', compact = false, onThemeChange }: Props) {
  const [themeConfigs, setThemeConfigs] = useState<Record<string, CampReportThemeConfig>>(() => loadCampReportThemeConfigs());
  const [majorCamp, setMajorCamp] = useState<CampMajorLevel>(defaultMajorCamp);
  const [logoImage, setLogoImage] = useState('');
  const [colorReferenceImage, setColorReferenceImage] = useState('');
  const [palette, setPalette] = useState<CampReportPalette>(() => getDefaultCampTheme(defaultMajorCamp).palette);
  const [source, setSource] = useState<CampReportThemeConfig['source']>('default');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const defaultTheme = getDefaultCampTheme(majorCamp);
    const savedTheme = themeConfigs[majorCamp];
    const nextLogo = savedTheme?.logoImage || defaultTheme.logoImage;
    setLogoImage(nextLogo);
    setColorReferenceImage(nextLogo);
    setPalette(normalizePalette(savedTheme?.palette, defaultTheme.palette));
    setSource(savedTheme?.source || 'default');
  }, [majorCamp, themeConfigs]);

  const previewTheme = useMemo(() => ({
    ...getDefaultCampTheme(majorCamp),
    logoImage,
    palette: normalizePalette(palette, getDefaultCampTheme(majorCamp).palette),
  }), [majorCamp, logoImage, palette]);

  const previewVars = useMemo(() => buildCampThemeVars(previewTheme), [previewTheme]);
  const savedCount = useMemo(() => Object.keys(themeConfigs).length, [themeConfigs]);

  async function applyImagePalette(image: string, nextSource: CampReportThemeConfig['source'], label: string) {
    setColorReferenceImage(image);
    try {
      const accent = await extractDominantColorFromImage(image);
      setPalette(createPaletteFromAccent(accent));
      setSource(nextSource);
      setNotice(`已从${label}识别主色 ${accent}，可以继续手动微调。`);
    } catch (error) {
      setSource('manual');
      setNotice(error instanceof Error ? error.message : `${label}取色失败，可以手动选色。`);
    }
  }

  async function handleLogoImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const image = await readFileAsDataUrl(file);
    setLogoImage(image);
    await applyImagePalette(image, 'logo', 'Logo');
  }

  async function handleReferenceImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const image = await readFileAsDataUrl(file);
    await applyImagePalette(image, 'image', '参考图');
  }

  async function reExtractFromReferenceImage() {
    const image = colorReferenceImage || logoImage;
    if (!image) {
      setNotice('请先上传 Logo 或参考图。');
      return;
    }
    try {
      const accent = await extractDominantColorFromImage(image);
      setPalette(createPaletteFromAccent(accent));
      setSource(source === 'logo' ? 'logo' : 'image');
      setNotice(`已重新识别主色 ${accent}。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '参考图取色失败。');
    }
  }

  function updateColor(key: keyof CampReportPalette, value: string) {
    setPalette((current) => normalizePalette({ ...current, [key]: value }, getDefaultCampTheme(majorCamp).palette));
    setSource('manual');
  }

  function regenerateFromAccent() {
    setPalette((current) => createPaletteFromAccent(current.accent));
    setSource('manual');
    setNotice('已按当前主色重新生成整套配色。');
  }

  function saveTheme() {
    const defaultTheme = getDefaultCampTheme(majorCamp);
    upsertCampReportThemeConfig({
      majorCamp,
      logoImage,
      palette: normalizePalette(palette, defaultTheme.palette),
      source: source === 'default' ? 'manual' : source,
      updatedAt: Date.now(),
    });
    setThemeConfigs(loadCampReportThemeConfigs());
    emitThemeUpdated(majorCamp);
    onThemeChange?.();
    setNotice(`已保存 ${majorCamp} ${getMajorCampName(majorCamp)} 主题。`);
  }

  function resetTheme() {
    deleteCampReportThemeConfig(majorCamp);
    const defaultTheme = getDefaultCampTheme(majorCamp);
    setThemeConfigs(loadCampReportThemeConfigs());
    setLogoImage(defaultTheme.logoImage);
    setColorReferenceImage(defaultTheme.logoImage);
    setPalette(defaultTheme.palette);
    setSource('default');
    emitThemeUpdated(majorCamp);
    onThemeChange?.();
    setNotice(`已恢复 ${majorCamp} 默认主题。`);
  }

  return (
    <section className={`summer-theme-manager${compact ? ' is-compact' : ''}`} style={previewVars}>
      <div className="summer-theme-manager-head">
        <div>
          <span className="summer-theme-eyebrow">Camp Theme</span>
          <h2>营主题配色</h2>
          <p>为不同大营保存 Logo 和配色，日报和座位表会一起更新。</p>
        </div>
        <div className="summer-theme-count">{savedCount} 套已保存</div>
      </div>

      <div className="summer-theme-controls">
        <label className="summer-theme-field">
          <span>大营</span>
          <select value={majorCamp} onChange={(event) => setMajorCamp(event.target.value as CampMajorLevel)}>
            {CAMP_MAJOR_OPTIONS.map((item) => (
              <option key={item.level} value={item.level}>{item.level} · {item.label}</option>
            ))}
          </select>
        </label>
        <label className="summer-theme-upload">
          <span>上传 Logo</span>
          <input type="file" accept="image/*" onChange={(event) => { void handleLogoImageUpload(event); }} />
        </label>
        <label className="summer-theme-upload">
          <span>上传参考图取色</span>
          <input type="file" accept="image/*" onChange={(event) => { void handleReferenceImageUpload(event); }} />
        </label>
        <button type="button" className="summer-theme-button" onClick={() => { void reExtractFromReferenceImage(); }}>
          重新识别
        </button>
      </div>

      <div className="summer-theme-body">
        <div className="summer-theme-preview">
          <div className="summer-theme-image">
            {logoImage ? <img src={logoImage} alt={`${majorCamp} logo`} /> : <span>暂无 Logo</span>}
          </div>
          <div className="summer-theme-card">
            <span>{majorCamp}</span>
            <strong>{getMajorCampName(majorCamp) || '营主题'}</strong>
            <div>
              <em className="warm">模块 A</em>
              <em className="cool">模块 B</em>
            </div>
          </div>
        </div>

        <div className="summer-theme-color-grid">
          {THEME_COLOR_FIELDS.map((field) => (
            <label key={field.key} className="summer-theme-color-field">
              <span>{field.label}</span>
              <input
                type="color"
                value={palette[field.key]}
                onChange={(event) => updateColor(field.key, event.target.value)}
              />
              <code>{palette[field.key]}</code>
            </label>
          ))}
        </div>
      </div>

      <div className="summer-theme-actions">
        <span>当前来源：{getSourceLabel(source)}</span>
        <button type="button" className="summer-theme-button" onClick={regenerateFromAccent}>按主色重算</button>
        <button type="button" className="summer-theme-button" onClick={resetTheme}>恢复默认</button>
        <button type="button" className="summer-theme-button primary" onClick={saveTheme}>保存并应用</button>
      </div>

      {notice && <div className="summer-theme-notice">{notice}</div>}
    </section>
  );
}
