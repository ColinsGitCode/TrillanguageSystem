# 历史正文迁移资格审计

> 日期：2026-08-03
> 规则：`pronunciation-content-quality-v1`
> 性质：只读清单，不执行修复和迁移。

## 1. 结论

审计对象为基线备份中的 675 个 generation。自动规则将结果分为：

| 状态 | 数量 | 含义 |
|---|---:|---|
| `eligible` | 612 | 当前可进入 pronunciation dry-run，但仍需 hash 校验 |
| `needs-review` | 60 | 缺少正文开头标题，必须人工处理 |
| `excluded` | 3 | 测试/工件路径或测试卡型，不进入正常学习范围 |

另有 20 张卡包含工具/调用残留标记；它们可能与 60 张结构候选重叠，不能简单相加后直接删除。工具残留是独立人工审查理由。

```bash
node scripts/maintenance/auditPronunciationMigrationEligibility.js \
  --db /tmp/pronunciation-gate0.db \
  --output /tmp/pronunciation-eligibility.json
```

审计只输出 generation id、content hash、模型、日期、短语和规则理由，不输出整篇正文。

## 2. 60 张缺标题候选

以下候选全部来自 `gemini-2.5-flash`，时间集中在 2026-02-09 至 2026-02-10。它们只代表“需要人工决定”，不代表可以自动修复或归档。

| id | content hash | model | created at | phrase |
|---:|---|---|---|---|
| 256 | 11c1b1779103af4167844db2bd879b2ac910d36c34536b3bfd2bc760f69e6710 | gemini-2.5-flash | 2026-02-09 15:39:45 | 持续集成 |
| 257 | eb2158b90f402bb4da7520448c8ca94bc7d3415e712c274f110f493a3ec69999 | gemini-2.5-flash | 2026-02-09 15:41:18 | 错误恢复机制 |
| 259 | 06703f77d5b959fdbbc8aa30f0ce9bf06c3ea6e91051aefe162e4d0f2b1f1fd5 | gemini-2.5-flash | 2026-02-09 15:44:56 | 带节奏 |
| 270 | 1f55fd248c570cf07b024808f0fee5c1579b277976d7ef1309e588bac86995e9 | gemini-2.5-flash | 2026-02-09 15:52:25 | 多模型对比 |
| 271 | 77903ee80d3e30aae9ccbe2e8a4855ec0bb8a41e55be80a216d7d231b954cac8 | gemini-2.5-flash | 2026-02-09 15:53:00 | 多语言语义一致性 |
| 277 | b116a3b450df1915998c28bdb89eaf0012c89ce1682d427fd6c721e54ec342cc | gemini-2.5-flash | 2026-02-09 15:57:26 | 供应链 |
| 279 | 7e07f7df5ec9f5b13c94d0d067dd82d2fc03c59cd38ac31cc44c5c534d0cb766 | gemini-2.5-flash | 2026-02-09 15:58:55 | 函数调用 |
| 281 | ddb35f0dddccc36135f109a222c413cdf2c6fc42826a013d71435b9b8928942c | gemini-2.5-flash | 2026-02-09 16:01:56 | 缓存穿透 |
| 283 | acf4733cf9d146ec64b0d0f84e0b1787874a3afee1aa946fd04232f87bfe22c4 | gemini-2.5-flash | 2026-02-09 16:03:32 | 回滚对应文件 |
| 298 | d86d73e54a3140ab60ba3f245eecf28e5f38d2cdf194b49d79ffee50dca87b6a | gemini-2.5-flash | 2026-02-10 00:37:12 | 连通性测试二 |
| 299 | a94eef686138d2fd1f3c1cf7395ed9190b176ace285a785a1b35e9e36248bcf6 | gemini-2.5-flash | 2026-02-10 00:37:42 | 廉洁诚信约定函 |
| 302 | 0b6f97d0be8a714797bcf901d98fb3fe4da5b154ab3cfe850c289b53cc2aa2814 | gemini-2.5-flash | 2026-02-10 00:40:27 | 没关系 |
| 304 | e5c7ec7a02062782b09f90706ca2419ee8bcb48530676e6c04e694e0377eddae | gemini-2.5-flash | 2026-02-10 00:41:37 | 模型微调 |
| 313 | 90039f09443d74c775077910a90cf146ac751f605fd88e09cf04973708ab1b40 | gemini-2.5-flash | 2026-02-10 00:47:02 | 实验可复现性 |
| 316 | 62c621acbeedfc048e8e4814852ab672512df5962c31789475701aba825809c4 | gemini-2.5-flash | 2026-02-10 00:48:25 | 数据管道 |
| 317 | 4202e4ee163d52c69a2d42085201abbca667eb5844651bbef0bd4faf3c3db7ce | gemini-2.5-flash | 2026-02-10 00:49:12 | 水很深 |
| 320 | 12d0798d68bd6ce5f3ef20c2ec84a2ee9722ebe6da809aa3f8b6b87f3e6d435c | gemini-2.5-flash | 2026-02-10 00:51:07 | 特征工程 |
| 322 | 8209ddf8f7c70040dc3d0826c1b387d9cf59714cbe4911bf63faf63766afc901 | gemini-2.5-flash | 2026-02-10 00:52:11 | 提示词工程 |
| 323 | 3de45ec641d8f7ed6b8a9c99f20794e6bd99dd43947a033b20016c53220adf04 | gemini-2.5-flash | 2026-02-10 00:53:21 | 吞吐量评估 |
| 327 | 30c9af5a73ee94936915fe6fe816989078f71819eabc8c967026c727cd050cf7 | gemini-2.5-flash | 2026-02-10 00:55:35 | 消息队列 |
| 329 | de73bb3ff988e641d5f5947c3f35547a09b9cf21eb5362f8617830d24f5c7dd0 | gemini-2.5-flash | 2026-02-10 00:57:24 | 辛苦了 |
| 339 | b6c72838e5e476f08819dd577c86be556718578216b3a4392a523bf4e96ff5c4 | gemini-2.5-flash | 2026-02-10 01:03:08 | 注意力机制 |
| 347 | e87d56ca0182dce129cd4ce45b4bbf76d9679a38447fe74d99c5f7569af85683 | gemini-2.5-flash | 2026-02-10 01:07:47 | model check quick |
| 355 | 9877ffd3e9e6c26c58ba9ae8ad8f16fb69ad1e2fc46f0de831bb4bba70a568f0 | gemini-2.5-flash | 2026-02-10 01:19:39 | Certificate Authority |
| 356 | 54af55e8b8d4c5e55d2ebf1bad9f6c4be4dfc3ad94f4b7b785f01962e575d4ed | gemini-2.5-flash | 2026-02-10 01:20:28 | combinations of features |
| 361 | 911471c3d8d5796a8ca4bb7a5ecd705c1413b73ff2da670b45c417ec71f60008 | gemini-2.5-flash | 2026-02-10 01:24:28 | 技术目标 |
| 366 | d7e214a11ea0542ae8ad23927f3c5d7968832da56f6d837498bf684f02606216 | gemini-2.5-flash | 2026-02-10 01:27:58 | 発注システム |
| 368 | 67400c8c9d889dbb42d125ae309b06c6bfb05f1e751765e977d92ef90a4e69ac | gemini-2.5-flash | 2026-02-10 01:30:07 | consecutive hyphens |
| 374 | 32af8fe573021392a91036e0a8c0927f2b9ce76041cd8d4ce70c83edd866bbb8 | gemini-2.5-flash | 2026-02-10 01:33:53 | 开曼群岛 |
| 381 | 629fcc064a5cb90f7e23e2cb7b3e05064d9fd0357c03295b6a96a1ec00ee1cdd | gemini-2.5-flash | 2026-02-10 01:37:51 | 最终采用的方案 |
| 384 | 3958556a5957503439183767fbcdeccb30116b79f90af6e85a824c4d7d554f2d | gemini-2.5-flash | 2026-02-10 01:40:14 | rare glyph |
| 385 | 25a6460616f998058b92926e7745ae3c2c6d0808bdc42c6e783b1666a16c6e91 | gemini-2.5-flash | 2026-02-10 01:40:54 | こまめに |
| 386 | ae72d42b7f81c7c4feddcf6c8dcea83d5c0d0bb8a5443b5401b0b30122deb2f1 | gemini-2.5-flash | 2026-02-10 01:41:48 | 延长保育 |
| 387 | e8a7abe7f4e310b8ee0c06a45cebe24c7eb0ccfa38868c7d74d1e8d87ef30d9c | gemini-2.5-flash | 2026-02-10 01:42:47 | 分割・リボ変更 |
| 389 | a00be843ad214fde194972889e60bfc21f6b7ea3ff97d670daa956223022a3a1 | gemini-2.5-flash | 2026-02-10 01:48:50 | 强人所难 |
| 390 | ec708cb60f8d795158e5d5093ae50ddbadacb1745d9fe9aa57f81e4931c5ea27 | gemini-2.5-flash | 2026-02-10 01:50:07 | issue postmortem |
| 391 | 1110b34e5d76ea43f49e888d7cf8e5a1d823adc9d7329bf0835090fefbb3fd4d | gemini-2.5-flash | 2026-02-10 01:51:03 | 细枝末节 |
| 392 | ab5eb67117af8993781c15bdda0b26b53cfb1f550b9756e8bb5f00c182bd1bc1 | gemini-2.5-flash | 2026-02-10 01:52:16 | 影视宣发 |
| 393 | 5a6d957e2016561f606e01313a3526dbd1c69db6f66f73c7b05fc07951bca836 | gemini-2.5-flash | 2026-02-10 01:53:02 | data aggregation |
| 397 | 501c4644834c68d0f40b442793068760b0335fa6f7783b968920cab7ebaaf3ad | gemini-2.5-flash | 2026-02-10 01:56:06 | is serialized to |
| 398 | 2ab6ccd1983031af6fed4441a376a3372c75f8195365474092b5423be4281f48 | gemini-2.5-flash | 2026-02-10 01:57:18 | modular architecture |
| 399 | 141ebe30fd8497fd80e01fc2619903796e0fe88dfcd69b58c4f5dbde4695290c | gemini-2.5-flash | 2026-02-10 01:58:18 | persistence |
| 401 | 076fb7dda4173f447ece38896c301095edd116f9ed0b2320af3a24542c97bcb6 | gemini-2.5-flash | 2026-02-10 01:59:30 | 固定开支 |
| 403 | d6912984ed553274b51b6166ab03107aba33356dfa5936cfd7315800d7bc5070 | gemini-2.5-flash | 2026-02-10 02:00:42 | 受注方 |
| 408 | f66b76645f2c5c70fa45e89d19095600c8aae5b0e9c316df27f4dd05a178a7ea | gemini-2.5-flash | 2026-02-10 02:19:29 | defragmenting |
| 409 | 4e097abea64a8c0c2862fac3194393b3a7bd069e7f7f4e5daa800166ee4db208 | gemini-2.5-flash | 2026-02-10 02:20:55 | fiddling with |
| 412 | 3434cd4381f63511b0e32bb55cdb2f60b0ed6af418c75f0175eb0ed06974d04d | gemini-2.5-flash | 2026-02-10 02:22:49 | hamster wheel |
| 413 | e6372ead0d8aa33b4b1423f36c64df9a06990bcd86636cb4f4eceb7b1e665373 | gemini-2.5-flash | 2026-02-10 02:23:09 | just a tick |
| 415 | a19c14eab857ce57f67f798e63cdb39274147b1174b9cead70a4760e4e0867e9 | gemini-2.5-flash | 2026-02-10 02:24:25 | shuffling punchlines |
| 417 | b52cb4e4f212df6ebeb12bacba185f815669cc53219afb0d3d6e4bb25b0d3aa2 | gemini-2.5-flash | 2026-02-10 02:26:09 | 鼻水 |
| 422 | 7ed5a2dc31b1084f77db25f447e6506aa1c3d3e22aee67b7a9 | gemini-2.5-flash | 2026-02-10 02:29:13 | 喉に痰がからんでいる |
| 425 | c1c5885a6bc844415cf30ab02e2862f533d2a260931e8ace8b6f47859433ef92 | gemini-2.5-flash | 2026-02-10 02:32:06 | 日中は元気に過ごしました |
| 427 | c6bd14c5729584d3cbfaedd46a565a79e3c3e338922ca374d3d53cd45c2a2e1d | gemini-2.5-flash | 2026-02-10 02:33:23 | 睡眠 |
| 430 | ce9ebd5b58184403b62649ca9d0fdeeda8097da861aae52476c68a7c40b60e59 | gemini-2.5-flash | 2026-02-10 02:34:50 | 一人でおもちゃで遊ぶ時間が長くなりました |
| 439 | fa90c08fe486e410afacac998311dfb2e52bdb99a27ac81dab76aa3976a53736 | gemini-2.5-flash | 2026-02-10 02:40:44 | 构建高精度可控可迭代的工业级Agent系统 |
| 441 | 69175c0b97f4077b5291b7eb922e78f6dbff90d8af379fc9bbf5289b4191c171 | gemini-2.5-flash | 2026-02-10 02:42:34 | 矛盾 |
| 447 | 28c498d3d6448c6d7db62abb846a083d5bb7d00dc2f112b8b121359e9e054a81 | gemini-2.5-flash | 2026-02-10 02:46:27 | 统一的计量币种 |
| 450 | cefd9a80c433264c9a8d66067823562c0b4a321e8969667ded5380e7aa2c8872 | gemini-2.5-flash | 2026-02-10 02:48:15 | 字体加载策略 |
| 458 | f57953b3723fe73f5336a8f3b7d878ede4fccfffa02cf7a1eb790b2a0de7a57e | gemini-2.5-flash | 2026-02-10 02:54:14 | 端到端验证 |
| 463 | 76bab5813136457db4b2306ffc52a4b1988781c5d707aaff13aed8fdc2354682 | gemini-2.5-flash | 2026-02-10 02:57:23 | take a rain check |

## 3. 处理规则

1. `needs-review` 不进入历史 pronunciation apply。
2. 结构修复、归档或保留必须由独立 decisions manifest 记录，不与 Ruby 退役迁移共写。
3. `eligible` 也必须经过 source content hash、读音抽样和 annotation shadow replay。
4. 工具残留不自动删除；先保留原始内容和审计 hash。
