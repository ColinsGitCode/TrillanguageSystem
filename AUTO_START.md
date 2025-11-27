# Trilingual Records Viewer 自动拉起指南（Docker Desktop）

## 概述
- 目的：Docker Desktop 启动时自动拉起本应用，供局域网/本机访问。
- 运行方式：`docker compose` + `restart: unless-stopped`；Docker 引擎重启会自动重建并启动容器（除非你手工 stop 过）。
- 端口：3010（宿主机映射 3010 -> 容器 3010）。

## 前置条件
- 已安装 Docker Desktop 并登录；勾选「Login items / Start Docker Desktop when you log in」（Preferences › General）。
- 本仓库包含 `docker-compose.yml`，且宿主路径 `/Users/xueguodong/Desktop/trilingual_records` 已存在且含 HTML。

## 一次性初始化
1) 进入项目目录：
   ```bash
   cd /Users/xueguodong/WorkTechDir/Three_LANS_PJ_CodeX
   ```
2) 构建并后台启动：
   ```bash
   docker compose up -d --build
   ```
3) 验证：
   ```bash
   docker compose ps
   open http://localhost:3010
   ```
   若成功访问即可。此时容器带有 `restart: unless-stopped`，Docker 引擎重启会自动拉起。

## 之后的自动拉起行为
- 当 Docker Desktop 启动完成、引擎就绪后，之前在运行且带 `restart: unless-stopped` 的容器会自动重启。
- 如果你手工 `docker compose stop` 过，下次不会自动启动；需要再执行 `docker compose start` 或 `docker compose up -d`。

## 常用操作
- 查看状态：
  ```bash
  docker compose ps
  ```
- 查看日志：
  ```bash
  docker compose logs -f
  ```
- 手动停止（会禁用下次自动启动）：
  ```bash
  docker compose stop
  ```
- 手动启动（恢复自动拉起）：
  ```bash
  docker compose start
  ```
- 重新构建并替换运行中容器：
  ```bash
  docker compose up -d --build
  ```
- 彻底删除容器/网络（不会删宿主机数据目录）：
  ```bash
  docker compose down
  ```

## 更新代码后
1) 拉取/修改代码。
2) 重新构建并热替换：
   ```bash
   docker compose up -d --build
   ```

## 排查
- 端口占用：确保宿主 3010 未被其他进程使用。
- 数据路径：确认 `/Users/xueguodong/Desktop/trilingual_records` 可读（挂载是只读）。
- 若自动拉起失效：检查是否曾执行 `docker compose stop`；如是，运行 `docker compose start` 恢复。
