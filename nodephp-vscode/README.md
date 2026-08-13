# NodePHP - VS Code kengaytmasi

NodePHP (`.np`) tili uchun sintaksis highlight.

## Xususiyatlar

- `$name` kabi o'zgaruvchilar alohida rangda
- HTML teglar, CSS (`<style>`) va JS (`<script>`) to'liq highlight
- `<?nodephp ... ?>` bloklari JS sifatida ranglanadi
- Qavs moslashuvi va avtomatik yopish

## O'rnatish

### Lokal (papkadan)

```bash
code --install-extension C:\Users\user\Desktop\pl_nodephp\nodephp-vscode
```

### .vsix paket orqali

```bash
npx @vscode/vsce package
code --install-extension nodephp-vscode-0.0.1.vsix
```

### VS Code Marketplace'ga chiqarish

```bash
npx @vscode/vsce login nodephp
npx @vscode/vsce publish
```

> Eslatma: publish qilish uchun [vsce](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) va azure devops tokeni kerak.

## Yozuv

`test.np` faylini oching yoki quyidagicha sinab ko'ring:

```php
$name = "Muhammadhakim";
<html>
  <body>
    <h1>Salom, $name!</h1>
  </body>
</html>
```

`<?nodephp` va `?>` teglari orasidagi kod sof JS sifatida bajariladi va ranglanadi.
