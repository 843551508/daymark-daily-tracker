# 部署、升级与备份

## 1. 环境要求

- PHP 7.4 或更高版本
- PHP `sqlite3` 扩展
- Web 服务进程对 `data/` 目录有写权限
- 现代浏览器：Chrome、Edge、Firefox 或 Safari

检查环境：

```bash
php -v
php -m | grep -i sqlite
php -l api.php
```

Windows PowerShell：

```powershell
php -v
php -m | Select-String sqlite
php -l api.php
```

## 2. Windows / XAMPP

### PHP 内置服务

在项目目录运行：

```powershell
C:\xampp\php\php.exe -d extension=sqlite3 -S 127.0.0.1:8787
```

浏览器访问 `http://127.0.0.1:8787/`。

### XAMPP Apache

1. 将项目放入 `C:\xampp\htdocs\daymark`。
2. 打开 `C:\xampp\php\php.ini`。
3. 确认 `extension=sqlite3` 已启用。
4. 重启 Apache。
5. 访问 `http://127.0.0.1/daymark/`。

如果页面显示“本地模式”，访问 `/daymark/test.html` 查看具体错误。

## 3. Linux 快速部署

Debian / Ubuntu：

```bash
sudo apt update
sudo apt install -y php php-sqlite3
cd /var/www
sudo git clone https://github.com/843551508/daymark-daily-tracker.git daymark
sudo mkdir -p /var/www/daymark/data
sudo chown -R www-data:www-data /var/www/daymark/data
```

临时验证：

```bash
cd /var/www/daymark
php -S 127.0.0.1:8787
```

生产环境应使用 Apache 或 Nginx + PHP-FPM，不要把 PHP 内置服务直接暴露到公网。

## 4. Docker Compose

```bash
git clone https://github.com/843551508/daymark-daily-tracker.git
cd daymark-daily-tracker
docker compose up -d --build
```

默认端口为 `8787`。可修改环境变量：

```bash
DAYMARK_PORT=8080 docker compose up -d --build
```

升级：

```bash
git pull
docker compose up -d --build
```

停止服务：

```bash
docker compose down
```

`data/` 通过 Docker named volume `daymark_data` 持久化，删除容器不会删除数据库。`docker compose down -v` 会同时删除该卷和其中的数据，执行前必须先导出备份。

## 4.1 GitHub Pages（仅静态模式）

GitHub Pages 不执行 PHP，因此只能运行浏览器 `localStorage` 模式，无法使用 SQLite 同步。适合公开演示界面，不适合作为多设备数据服务。

1. 在 GitHub 仓库打开 `Settings -> Pages`。
2. 在 `Build and deployment` 中选择 `Deploy from a branch`。
3. 选择 `main` 和 `/ (root)` 后保存。
4. 等待 Pages 构建完成后访问 GitHub 给出的地址。

页面右上角显示“本地模式”属于预期行为。此模式的数据只存在当前浏览器中，清理站点数据会丢失记录，请定期从“数据中心”导出 JSON 备份。需要 PHP/SQLite 时使用 Docker、Apache、Nginx 或虚拟主机部署。

## 5. Apache

示例 VirtualHost：

```apache
<VirtualHost *:80>
    ServerName daymark.example.com
    DocumentRoot /var/www/daymark

    <Directory /var/www/daymark>
        Options -Indexes
        AllowOverride None
        Require all granted
        DirectoryIndex index.html
    </Directory>

    <FilesMatch "^\.git|\.md$|\.yml$|Dockerfile$">
        Require all denied
    </FilesMatch>

    ErrorLog ${APACHE_LOG_DIR}/daymark-error.log
    CustomLog ${APACHE_LOG_DIR}/daymark-access.log combined
</VirtualHost>
```

启用站点后重载 Apache：

```bash
sudo a2ensite daymark.conf
sudo apachectl configtest
sudo systemctl reload apache2
```

## 6. Nginx + PHP-FPM

```nginx
server {
    listen 80;
    server_name daymark.example.com;
    root /var/www/daymark;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    location = /api.php {
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
    }

    location ~ /(?:data|\.git|\.github|docs)/ {
        deny all;
    }

    location ~ \.php$ {
        deny all;
    }
}
```

检查配置并重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

根据实际 PHP 版本调整 `php8.3-fpm.sock`。

## 7. 虚拟主机 / 宝塔面板

1. 创建 PHP 站点并上传整个仓库内容。
2. 在 PHP 扩展管理中启用 SQLite3。
3. 将网站运行目录设为仓库根目录。
4. 给 `data/` 目录写权限，不要给整个站点 `777`。
5. 禁止外部访问 `/data`、`/.git`、`/.github`。
6. 访问 `test.html` 完成自检。

## 8. 公网安全

日迹定位为单用户工具，应用自身不包含账号和登录系统。不要直接把它暴露到公网。

推荐方案：

- 仅监听 `127.0.0.1`，通过本机使用。
- 通过 Tailscale、WireGuard 等私有网络访问。
- 在 Caddy、Nginx、Cloudflare Access 或 Authelia 前增加认证。
- 全程使用 HTTPS。
- 服务器防火墙只开放必要端口。

公开的是 GitHub 源码仓库，不是个人数据库。`data/*.db` 已被 Git 忽略，但仍应在每次提交前运行 `git status` 检查。

## 9. 备份

### 页面备份

数据中心选择“导出完整备份”，保存 JSON 文件。

### 数据库备份

SQLite 使用 WAL 模式。在线备份优先使用 SQLite 工具：

```bash
sqlite3 data/daymark.db ".backup 'backup/daymark-$(date +%F).db'"
```

Windows：

```powershell
sqlite3.exe data\daymark.db ".backup 'backup\daymark.db'"
```

如果直接复制数据库，应先停止 Web 服务，或者同时复制 `.db`、`.db-wal`、`.db-shm` 三个文件。

## 10. 升级与回滚

升级前：

1. 在页面导出 JSON。
2. 备份 `data/`。
3. 拉取新代码。
4. 运行 `php -l api.php` 和 `test.html` 自检。

Git 部署：

```bash
git pull --ff-only
```

回滚代码不会自动回滚数据库。需要完整回滚时，同时恢复升级前的 `data/` 备份。

旧版 FinFlow 的 `data/finflow.db` 会被自动识别并继续使用，新状态写入同一数据库中的 `app_state` 表。

## 11. 故障排查

### 页面显示“本地模式”

- 检查 `/api.php?endpoint=/api/health`。
- 检查 PHP 是否加载 `sqlite3`。
- 检查 `data/` 写权限。
- 查看 Web 服务器和 PHP 错误日志。

### SQLite 初始化失败

```bash
ls -la data
php -m | grep -i sqlite
```

不要把整个项目目录设置为 `777`。只应让 Web 用户写入 `data/`。

### 中文乱码

确保文件以 UTF-8 保存，服务器响应保留 `Content-Type: application/json; charset=UTF-8`，不要用网页翻译插件重新保存 HTML。
