# 交互式土星 3D 粒子系统

以 Three.js 构建的实时交互作品：摄像头检测手势控制缩放与扩散，土星核心与环由粒子构成，环动画遵循开普勒定律，临界放大触发高频无规则噪点产生“炸开”的混沌临场感。

## 功能
- MediaPipe Hands 手势张合 → 粒子缩放/扩散、亮度变化、混沌噪点
- 土星核心粒子球 + 倾角双环（B/A），包含 Cassini Division、Encke/Keeler 空隙
- 开普勒定律驱动环角速度 `ω = sqrt(GM / r^3)`
- 后期 Bloom + ACESFilm 色调映射（已降低曝光，深空星点背景）
- 极简界面：全屏按钮、摄像头小窗

## 预览
本地启动：

```bash
python -m http.server 5500
# 打开 http://localhost:5500/
```

## GitHub Pages
此仓库已配置 GitHub Actions 自动部署到 Pages：
- 工作流文件：`.github/workflows/pages.yml`
- 静态站点路径：仓库根目录（即本项目）

推送到 GitHub 的 `main` 分支后，Actions 会自动发布到 Pages，在 Actions 的日志中可见访问 URL。

## 部署步骤（HTTPS）
```bash
git init -b main
git add .
git commit -m "feat: interactive Saturn particle system and Pages workflow"
git remote add origin https://github.com/<你的用户名>/<你的仓库名>.git
git push -u origin main
```

## 许可证
MIT

