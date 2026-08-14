/**
 * dsh-skin-switcher — browser half.
 *
 * Registers a "皮肤" (Skins) section into the official settings panel
 * (`settings.section`, declared by the settings shell). The section lists
 * the official stock look plus every skin the host discovered, marks the
 * active one, and offers one-click switch buttons. Switching POSTs to the
 * host `/api/skin-switcher/use` route (same-origin fetch); once the config
 * watcher reports the target active, the page reloads to pick up the new
 * client plugin roster. No model access, no extra services beyond `slots`.
 */

window.__ModuleLoader__.load({
	id: "dsh-skin-switcher",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		const { useState, useEffect, useRef } = react;
		const h = react.createElement;

		//#region styles ----------------------------------------------------------
		const css = [
			".ssw_root{flex-direction:column;width:100%;gap:18px;padding:6px 2px;display:flex}",
			".ssw_head{flex-direction:column;gap:6px;display:flex}",
			".ssw_title{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:22px;margin:0}",
			".ssw_hint{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:0}",
			".ssw_error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin:0;white-space:pre-wrap}",
			".ssw_list{flex-direction:column;gap:12px;display:flex}",
			".ssw_card{box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;flex-direction:column;gap:10px;padding:14px 16px;display:flex}",
			".ssw_card.ssw_active{border-color:var(--dsw-static-neutral-bluish-400);box-shadow:inset 0 0 0 1px var(--dsw-static-neutral-bluish-400)}",
			".ssw_row{align-items:center;gap:12px;display:flex;min-width:0}",
			".ssw_meta{flex-direction:column;gap:2px;flex:1;min-width:0;display:flex}",
			".ssw_name{align-items:baseline;gap:8px;display:flex;flex-wrap:wrap}",
			".ssw_nameMain{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:22px}",
			".ssw_nameEn{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}",
			".ssw_sub{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;display:flex;gap:8px;flex-wrap:wrap}",
			".ssw_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0;max-width:520px}",
			".ssw_badge{flex:none;color:var(--dsw-static-neutral-bluish-400);border:1px solid currentColor;border-radius:999px;padding:2px 10px;font-size:12px;line-height:18px}",
			".ssw_btn{box-sizing:border-box;flex:none;cursor:pointer;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:6px 14px;font-family:inherit;font-size:13px;line-height:20px}",
			".ssw_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
			".ssw_btn:disabled{cursor:default;opacity:.55}",
			".ssw_btnPrimary{color:#fff;background:var(--dsw-static-neutral-bluish-400);border-color:transparent}",
			".ssw_btnPrimary:hover:not(:disabled){filter:brightness(.92)}",
			".ssw_empty{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}",
			/* Settings-nav icon: the official shell hard-codes nav glyphs by
			   section id and falls back to the gear for unknown ids. The skin
			   switcher marks its own nav cell (data-ssw-nav, applied by the
			   DOM walker in apply()) and paints a palette glyph through a
			   CSS mask so it follows the current text color (light/dark). */
			"[data-ssw-nav]{position:relative}",
			"[data-ssw-nav]>svg{display:none}",
			"[data-ssw-nav]::before{content:'';flex:none;width:16px;height:16px;background-color:currentColor;-webkit-mask:url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 0C3.6 0 0 3.6 0 8c0 4.4 3.6 8 8 8 .9 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6h.2A5.4 5.4 0 0 0 16 5.3C16 2.4 12.4 0 8 0z'/%3E%3Cpath fill='%23000' d='M5.2 2.4a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z'/%3E%3Cpath fill='%23000' d='M8 2.4a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z'/%3E%3Cpath fill='%23000' d='M10.8 2.4a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z'/%3E%3C/svg%3E\") center / contain no-repeat;mask:url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 0C3.6 0 0 3.6 0 8c0 4.4 3.6 8 8 8 .9 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6h.2A5.4 5.4 0 0 0 16 5.3C16 2.4 12.4 0 8 0z'/%3E%3Cpath fill='%23000' d='M5.2 2.4a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z'/%3E%3Cpath fill='%23000' d='M8 2.4a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z'/%3E%3Cpath fill='%23000' d='M10.8 2.4a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z'/%3E%3C/svg%3E\") center / contain no-repeat}",
		].join("");
		const cssTagId = "dsh-skin-switcher/client.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(cssTagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-skin-switcher";
			tag.dataset.pluginCss = cssTagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region api -------------------------------------------------------------
		/** Poll the host state until the watcher reports the target active. */
		function confirmActive(target, budgetMs = 8000) {
			const expected = target === "official" ? "none" : target;
			return new Promise((resolve) => {
				const started = Date.now();
				const tick = () => {
					fetch("/api/skin-switcher/state")
						.then(async (response) => {
							const payload = await response.json().catch(() => null);
							if (response.ok && payload && payload.ok === true && payload.active === expected) {
								resolve(true);
								return;
							}
							if (Date.now() - started >= budgetMs) resolve(false);
							else window.setTimeout(tick, 300);
						})
						.catch(() => {
							if (Date.now() - started >= budgetMs) resolve(false);
							else window.setTimeout(tick, 300);
						});
				};
				tick();
			});
		}

		function requestUse(target) {
			const body = target === "official" ? { official: true } : { skin: target };
			return fetch("/api/skin-switcher/use", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
		}
		//#endregion

		//#region components --------------------------------------------------------
		/**
		 * The Skins settings section: stock look + discovered skins, each with
		 * an active badge and a one-click switch button.
		 */
		function SkinSection() {
			const [state, setState] = useState({ phase: "loading", active: "none", skins: [] });
			const [applying, setApplying] = useState(null);
			const [error, setError] = useState(null);
			const mounted = useRef(true);

			useEffect(() => {
				mounted.current = true;
				const load = () => {
					fetch("/api/skin-switcher/state")
						.then(async (response) => {
							const payload = await response.json().catch(() => null);
							if (!mounted.current) return;
							if (!response.ok || payload === null || payload.ok !== true) {
								throw new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`);
							}
							setState({ phase: "ready", active: payload.active, skins: payload.skins });
						})
						.catch((cause) => {
							if (!mounted.current) return;
							setState({ phase: "error", active: "none", skins: [] });
							setError(cause instanceof Error ? cause.message : String(cause));
						});
				};
				load();
				return () => {
					mounted.current = false;
				};
			}, []);

			const applySkin = (target) => {
				setError(null);
				setApplying(target);
				requestUse(target)
					.then(async (response) => {
						const payload = await response.json().catch(() => null);
						if (!response.ok || payload === null || payload.ok !== true) {
							throw new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`);
						}
						const confirmed = await confirmActive(target);
						if (!mounted.current) return;
						if (confirmed) {
							// The patch file is written, but the HMR watcher still needs a
							// beat to reapply it to the boot graph. Wait a short grace
							// period before reloading so the page boots with the new
							// client plugin roster.
							window.setTimeout(() => {
								if (mounted.current) window.location.reload();
							}, 1500);
						} else {
							setApplying(null);
							setError(`已写入配置，但配置监视器暂未确认生效。可稍后手动刷新页面（或检查 ~/.dsh/cordis.patch.yml）。`);
						}
					})
					.catch((cause) => {
						if (!mounted.current) return;
						setApplying(null);
						setError(cause instanceof Error ? cause.message : String(cause));
					});
			};

			const busy = applying !== null;

			const officialCard = h("div", {
				key: "official",
				className: "ssw_card" + (state.active === "none" ? " ssw_active" : ""),
				children: [
					h("div", { className: "ssw_row", children: [
						h("div", { className: "ssw_meta", children: [
							h("div", { className: "ssw_name", children: [
								h("span", { className: "ssw_nameMain", children: "默认外观" }),
								h("span", { className: "ssw_nameEn", children: "Official Stock Look" }),
							] }),
							h("div", { className: "ssw_sub", children: [
								h("span", null, "DeepSeek Harness 官方默认界面"),
							] }),
						] }),
						state.active === "none" ? h("span", { className: "ssw_badge", children: "使用中" }) : null,
						h("button", {
							type: "button",
							className: "ssw_btn" + (state.active === "none" ? "" : " ssw_btnPrimary"),
							disabled: busy || state.active === "none",
							onClick: () => applySkin("official"),
							children: applying === "official" ? "切换中..." : (state.active === "none" ? "使用中" : "恢复默认"),
						}),
					] }),
				],
			});

			const skinCards = state.skins.map((skin) => {
				const isActive = state.active === skin.id;
				return h("div", {
					key: skin.id,
					className: "ssw_card" + (isActive ? " ssw_active" : ""),
					children: [
						h("div", { className: "ssw_row", children: [
							h("div", { className: "ssw_meta", children: [
								h("div", { className: "ssw_name", children: [
									h("span", { className: "ssw_nameMain", children: skin.name }),
									skin.nameEn ? h("span", { className: "ssw_nameEn", children: skin.nameEn }) : null,
								] }),
								h("div", { className: "ssw_sub", children: [
									skin.author ? h("span", null, `作者 ${skin.author}`) : null,
									skin.tagline ? h("span", null, skin.tagline) : null,
									h("span", null, skin.package),
								] }),
							] }),
							isActive ? h("span", { className: "ssw_badge", children: "使用中" }) : null,
							h("button", {
								type: "button",
								className: "ssw_btn" + (isActive ? "" : " ssw_btnPrimary"),
								disabled: busy || isActive,
								onClick: () => applySkin(skin.id),
								children: applying === skin.id ? "切换中..." : (isActive ? "使用中" : "使用"),
							}),
						] }),
						skin.description ? h("p", { className: "ssw_desc", children: skin.description }) : null,
					],
				});
			});

			const body = state.phase === "loading"
				? h("p", { className: "ssw_empty", children: "正在读取已安装皮肤..." })
				: state.phase === "error"
					? h("p", { className: "ssw_error", children: `无法读取皮肤状态：${error ?? "未知错误"}` })
					: state.skins.length === 0
						? h("p", { className: "ssw_empty", children: "未发现已安装的皮肤。通过 dsh plugin --profile web add <皮肤包> 安装后，将在此处列出。" })
						: h("div", { className: "ssw_list", children: [officialCard, ...skinCards] });

			return h("div", { className: "ssw_root", children: [
				h("div", { className: "ssw_head", children: [
					h("p", { className: "ssw_title", children: "皮肤" }),
					h("p", { className: "ssw_hint", children: "切换皮肤后配置将热重载并自动刷新页面；恢复默认即可回到官方界面。" }),
				] }),
				error !== null ? h("p", { className: "ssw_error", role: "alert", children: error }) : null,
				body,
			] });
		}
		//#endregion

		//#region plugin -----------------------------------------------------------
		/** Required services: slots (section registration). */
		const inject = ["slots"];

		/**
		 * Mark the settings-nav cell that owns this section (the official
		 * shell renders a fallback gear glyph for unknown section ids; the
		 * CSS above paints a palette glyph once the cell carries
		 * data-ssw-nav). The nav can re-render on ledger/locale changes, so a
		 * cheap body-level observer re-applies the marker whenever the cell
		 * (re)mounts.
		 */
		function markSkinNav() {
			const labels = new Set(["皮肤", "Skins", "Skin"]);
			const cells = document.querySelectorAll("button");
			for (const cell of cells) {
				if (cell.hasAttribute("data-ssw-nav")) continue;
				for (const child of cell.children) {
					if (child.tagName !== "SPAN") continue;
					if (labels.has(child.textContent.trim())) {
						cell.setAttribute("data-ssw-nav", "");
						break;
					}
				}
			}
		}

		/**
		 * Register the Skins section into the settings panel once the
		 * settings.section slot type is on the ledger.
		 */
		function apply(ctx) {
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "skin-switcher",
				order: 10,
				label: () => "皮肤",
			}, SkinSection));
			const navObserver = new MutationObserver(markSkinNav);
			navObserver.observe(document.body, { childList: true, subtree: true });
			markSkinNav();
			ctx.effect(() => () => navObserver.disconnect(), "dsh-skin-switcher: nav icon marker");
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
