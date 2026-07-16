# Security Policy

## Supported Version

当前只维护 `main` 分支最新版本。

## Deployment Boundary

日迹是单用户、本地优先工具，没有内置账户、会话或权限系统。默认 API 可以读写全部应用状态，因此：

- 不要未经认证直接暴露到公网。
- 使用 localhost、私有网络或带身份认证的反向代理。
- 使用 HTTPS 保护传输中的个人数据。
- 禁止 Web 访问 `data/`、`.git/` 和备份目录。
- 不要提交 SQLite 数据库、JSON 备份或真实个人数据。

详见 [部署安全章节](docs/DEPLOYMENT.md#8-公网安全)。

## Reporting

请通过 GitHub Security Advisory 私下报告安全问题，不要在公开 Issue 中附带个人数据、数据库、Token 或可直接利用的敏感信息。

报告应包含：

- 受影响版本或提交
- 复现步骤
- 实际影响
- 建议修复方式（如有）
