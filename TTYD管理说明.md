# ttyd 服务管理（macOS，LaunchAgent）

## 服务信息
- 配置文件：`~/Library/LaunchAgents/com.local.ttyd7681.plist`
- 命令：`/opt/homebrew/bin/ttyd --writable -p 7681 /bin/zsh`
- 监听端口：7681（本机访问 `http://localhost:7681/`）
- 日志：`~/Library/Logs/ttyd-7681.log`
- 用户：当前登录用户（使用 GUI 会话）

## 常用命令
- 重新加载并启动服务：
  ```bash
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.local.ttyd7681.plist
  launchctl enable gui/$(id -u)/com.local.ttyd7681
  launchctl kickstart -k gui/$(id -u)/com.local.ttyd7681
  ```

- 重启服务：
  ```bash
  launchctl kickstart -k gui/$(id -u)/com.local.ttyd7681
  ```

- 停止并卸载服务：
  ```bash
  launchctl bootout gui/$(id -u)/com.local.ttyd7681
  ```

- 查看状态：
  ```bash
  launchctl list | grep ttyd
  ```

- 查看日志：
  ```bash
  tail -f ~/Library/Logs/ttyd-7681.log
  ```

## 注意事项
- 确保端口 7681 未被其它进程占用。
- 如果修改了 plist 文件，需重新 bootstrap 并 kickstart 才会生效。
- 如需更换 shell 或端口，请同时更新 plist 的 `ProgramArguments`。
