# 🐘 NodePHP

PHP sintaksisi va faylli marshrutlash tizimini Node.js va Vercel'da ishlatish uchun freymvork.

## 🚀 O'rnatish

```bash
npm install nodephp-js
```

## ✍️ Sintaksis

`.np` fayllarida HTML va JavaScript aralash yoziladi. `$` bilan boshlanganlar o'zgaruvchi hisoblanadi.

```php
$name = "Muhammadhakim";

<html>
  <body>
    <h1>Salom, $name!</h1>
  </body>
</html>
```

### JavaScript mantig'i

HTML va JS qatorlari avtomatik ajratiladi. Oddiy JS shunday yoziladi:

```php
$items = ["Olma", "Banan"];

<ul>
  for ($i = 0; $i < 2; $i++) {
    <li>$items[$i]</li>
  }
</ul>
```

Qo'llab-quvvatlanadi: o'zgaruvchi biriktirish, `if/else`, `for/while`, `switch`, funksiyalar, `res.json()`/`res.send()`, `console.log()`, `fetch()`, ko'p qatorli array/object literallar.

### So'rov ma'lumotlari (`file()`)

```php
if (file("POST")) {
  $name = file("POST").body("name");
  <h1>POST: $name</h1>
} else {
  <p>Bu GET so'rovi</p>
}
```

- `file("POST")` — so'rov metodiga mos bo'lsa obyekt, aks holda `false`
- `file("POST").query("key")` — URL query parametrlari
- `file("POST").body("key")` — POST/JSON tanasi
- `file("POST").all()` — query + body + headers

### Sof JS bloki: `<?nodephp ... ?>`

Avtomatik aniqlash ishlamaydigan holatlarda (masalan oddiy funksiya chaqiruvlari) JS ni aniq belgilash mumkin:

```php
<?nodephp
const upper = "salom".toUpperCase();
res.write(upper);
?>
```

Blok ichidagi hamma narsa sof JS sifatida bajariladi. `$var` blok ichida ham o'zgaruvchi bo'lib qolaveradi.

### Tarmoq so'rovi: `connect()`

Tashqi manzilga HTTP so'rov yuboradi va `{ status, ok, data, headers }` qaytaradi. **`await` shart** (funksiya async):

```php
<?nodephp
$r = await connect("https://api.example.com/users", "GET");
res.write("status: " + $r.status);
res.write("ism: " + $r.data.name);
?>
```

- `connect(url)` — GET so'rovi (avtomatik JSON parse)
- `connect(url, "POST", data)` — JSON body bilan POST/PUT/PATCH/DELETE

### Fayllar bilan ishlash: `readFile()`, `writeFile()`

```php
<?nodephp
writeFile("data.txt", "salom dunyo");
$content = readFile("data.txt");
res.write($content);
?>
```

- `writeFile(path, data)` — yangi fayl yaratadi yoki mavjud faylni to'liq ustiga yozadi (obyekt bo'lsa JSON), `true` qaytaradi
- `readFile(path)` — fayl kontentini qaytaradi; fayl topilmasa yoki bo'sh bo'lsa xato tashlaydi

### Faylni to'xtatish: `kill;`

`kill;` buyrug'i fayl bajarilishini shu nuqtada **majburiy to'xtatadi** — keyingi qatorlar bajarilmaydi:

```php
<?nodephp
if (true) {
    res.write("salom");
    kill;
}
res.write("bu hech qachon chiqmaydi");
?>
```

### `<style>` va `<script>` bloklari

Ularning ichidagi matn o'zgartirilmasdan (CSS/JS xom matn sifatida) chiqariladi.

## 🖥️ Lokal ishga tushirish

```bash
nodephp start
# yoki
PORT=5000 nodephp start
```

So'rovlar `.np` bilan tugashi kerak: `http://localhost:3000/test.np`

## ▲ Vercel uchun

```bash
nodephp build
```

`api/index.js` va `vercel.json` avtogeneratsiya qilinadi.

## 🧪 Testlar

```bash
npm test
```

## 📋 Ma'lum cheklovlar

- `$` har doim NodePHP o'zgaruvchisi ma'nosida (masalan `$5.00` narxda muammo yo'q, lekin jQuery'ning `$` ishlatilmaydi)
- HTML matn qatorlari kalit so'z bilan boshlansa ham (`for more info...`) buzilmaydi — kalit so'z faqat `(`/`{` bilan davom etsa JS hisoblanadi
- `file("METHOD")` ga mos bo'lmagan metodda `.body()/.query()` ishlatishdan oldin `if (file("METHOD"))` tekshirish tavsiya etiladi

## 📄 Litsenziya

MIT
