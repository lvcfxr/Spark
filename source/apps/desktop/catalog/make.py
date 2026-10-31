# Встроенные колоды Spark. Содержимое — общеизвестные факты и слова (авторская подборка Spark).
import json
decks = []
def deck(id, emoji, title, title_en, desc, desc_en, lf, lb, tags, cards):
    decks.append(dict(id=id, emoji=emoji, title=title, title_en=title_en, description=desc, description_en=desc_en,
                      lang_front=lf, lang_back=lb, tags=tags, count=len(cards), version=1, author="Spark", file=f"{id}.json"))
    json.dump({"id": id, "version": 1, "cards": cards}, open(f"{id}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)

def pairs(rows, hint_idx=None):
    out = []
    for r in rows:
        c = {"front": r[0], "back": r[1]}
        if len(r) > 2 and r[2]: c["hint"] = r[2]
        if len(r) > 3 and r[3]: c["extra"] = r[3]
        out.append(c)
    return out

N, V, A = "сущ.", "гл.", "прил."
deck("en-basics", "🇬🇧", "English: 60 базовых слов", "English: 60 core words",
 "Самые частые английские слова: существительные, глаголы и прилагательные. Хорошее начало для изучения языка.",
 "The most frequent English words — nouns, verbs and adjectives, with Russian translations.",
 "en", "ru", ["english", "beginner"], pairs([
 ("time","время",N),("year","год",N),("people","люди",N),("day","день",N),("man","мужчина; человек",N),("woman","женщина",N),
 ("child","ребёнок",N),("life","жизнь",N),("world","мир",N),("family","семья",N),("friend","друг",N),("school","школа",N),
 ("country","страна",N),("city","город",N),("house","дом (здание)",N),("room","комната",N),("door","дверь",N),("water","вода",N),
 ("money","деньги",N),("book","книга",N),("word","слово",N),("question","вопрос",N),("work","работа",N),("hour","час",N),
 ("week","неделя",N),("month","месяц",N),("night","ночь",N),("name","имя",N),("idea","идея",N),("head","голова",N),
 ("be","быть",V),("have","иметь",V),("do","делать",V),("say","сказать",V),("go","идти; ехать",V),("get","получать",V),
 ("make","делать; создавать",V),("know","знать",V),("think","думать",V),("take","брать",V),("see","видеть",V),("come","приходить",V),
 ("want","хотеть",V),("look","смотреть",V),("use","использовать",V),("find","находить",V),("give","давать",V),("tell","рассказывать",V),
 ("good","хороший",A),("new","новый",A),("first","первый",A),("last","последний",A),("long","длинный",A),("great","отличный; великий",A),
 ("little","маленький",A),("old","старый",A),("big","большой",A),("young","молодой",A),("important","важный",A),("different","разный; другой",A)]))

deck("en-irregular", "🔁", "Неправильные глаголы английского", "English irregular verbs",
 "54 самых нужных неправильных глагола: три формы и перевод. Удобно учить с вводом ответа.",
 "54 essential irregular verbs: base form → past simple — past participle, with Russian translation.",
 "en", "ru", ["english", "grammar"], [
 {"front": b, "back": f"{p} — {pp}", "hint": tr} for b, p, pp, tr in [
 ("be","was / were","been","быть"),("become","became","become","становиться"),("begin","began","begun","начинать"),
 ("break","broke","broken","ломать"),("bring","brought","brought","приносить"),("build","built","built","строить"),
 ("buy","bought","bought","покупать"),("catch","caught","caught","ловить"),("choose","chose","chosen","выбирать"),
 ("come","came","come","приходить"),("cost","cost","cost","стоить"),("cut","cut","cut","резать"),("do","did","done","делать"),
 ("draw","drew","drawn","рисовать"),("drink","drank","drunk","пить"),("drive","drove","driven","водить машину"),
 ("eat","ate","eaten","есть"),("fall","fell","fallen","падать"),("feel","felt","felt","чувствовать"),("find","found","found","находить"),
 ("fly","flew","flown","летать"),("forget","forgot","forgotten","забывать"),("get","got","got","получать"),("give","gave","given","давать"),
 ("go","went","gone","идти"),("grow","grew","grown","расти"),("have","had","had","иметь"),("hear","heard","heard","слышать"),
 ("keep","kept","kept","держать; хранить"),("know","knew","known","знать"),("leave","left","left","оставлять; уходить"),
 ("lose","lost","lost","терять"),("make","made","made","делать"),("meet","met","met","встречать"),("pay","paid","paid","платить"),
 ("put","put","put","класть"),("read","read","read","читать"),("run","ran","run","бежать"),("say","said","said","сказать"),
 ("see","saw","seen","видеть"),("sell","sold","sold","продавать"),("send","sent","sent","отправлять"),("sit","sat","sat","сидеть"),
 ("sleep","slept","slept","спать"),("speak","spoke","spoken","говорить"),("spend","spent","spent","тратить"),
 ("stand","stood","stood","стоять"),("swim","swam","swum","плавать"),("take","took","taken","брать"),
 ("teach","taught","taught","учить (кого-то)"),("tell","told","told","рассказывать"),("think","thought","thought","думать"),
 ("understand","understood","understood","понимать"),("write","wrote","written","писать")]])

deck("es-basics", "🇪🇸", "Español: первые 50 слов", "Spanish: first 50 words",
 "Приветствия, предметы вокруг, цвета, частые глаголы и числа. Существительные — с артиклем.",
 "Greetings, everyday objects, colours, common verbs and numbers — with Russian translations.",
 "es", "ru", ["spanish", "beginner"], pairs([
 ("hola","привет"),("adiós","до свидания"),("gracias","спасибо"),("por favor","пожалуйста"),("sí","да"),("no","нет"),
 ("el agua","вода"),("la casa","дом"),("el perro","собака"),("el gato","кошка"),("el libro","книга"),("la mesa","стол"),
 ("la silla","стул"),("el coche","машина","в Испании"),("la ciudad","город"),("el día","день"),("la noche","ночь"),
 ("el tiempo","время; погода"),("el amigo","друг"),("la familia","семья"),("el trabajo","работа"),("la escuela","школа"),
 ("la comida","еда"),("el pan","хлеб"),("la leche","молоко"),("el café","кофе"),("rojo","красный"),("azul","синий"),
 ("verde","зелёный"),("blanco","белый"),("negro","чёрный"),("grande","большой"),("pequeño","маленький"),("bueno","хороший"),
 ("malo","плохой"),("nuevo","новый"),("viejo","старый"),("hablar","говорить"),("comer","есть"),("beber","пить"),("vivir","жить"),
 ("ser","быть","постоянное качество"),("estar","быть","состояние, местоположение"),("tener","иметь"),("ir","идти; ехать"),
 ("hacer","делать"),("querer","хотеть; любить"),("uno","один"),("dos","два"),("tres","три")]))

deck("de-basics", "🇩🇪", "Deutsch: первые 50 слов", "German: first 50 words",
 "Базовая лексика немецкого: приветствия, предметы, цвета, глаголы и числа. Существительные — с артиклем.",
 "Core German vocabulary with articles: greetings, objects, colours, verbs and numbers.",
 "de", "ru", ["german", "beginner"], pairs([
 ("Hallo","привет"),("Tschüss","пока"),("Danke","спасибо"),("Bitte","пожалуйста; не за что"),("ja","да"),("nein","нет"),
 ("das Wasser","вода"),("das Haus","дом"),("der Hund","собака"),("die Katze","кошка"),("das Buch","книга"),("der Tisch","стол"),
 ("der Stuhl","стул"),("das Auto","машина"),("die Stadt","город"),("der Tag","день"),("die Nacht","ночь"),("die Zeit","время"),
 ("der Freund","друг"),("die Familie","семья"),("die Arbeit","работа"),("die Schule","школа"),("das Essen","еда"),("das Brot","хлеб"),
 ("die Milch","молоко"),("der Kaffee","кофе"),("rot","красный"),("blau","синий"),("grün","зелёный"),("weiß","белый"),
 ("schwarz","чёрный"),("groß","большой"),("klein","маленький"),("gut","хороший"),("schlecht","плохой"),("neu","новый"),("alt","старый"),
 ("sprechen","говорить"),("essen","есть"),("trinken","пить"),("wohnen","жить","проживать где-то"),("sein","быть"),("haben","иметь"),
 ("gehen","идти"),("machen","делать"),("wollen","хотеть"),("eins","один"),("zwei","два"),("drei","три"),("heute","сегодня")]))

deck("ru-basics", "🇷🇺", "Русский: 50 первых слов", "Russian: first 50 words",
 "Базовые русские слова для англоязычных: с транслитерацией.",
 "Core Russian words for English speakers, with transliteration hints.",
 "ru", "en", ["russian", "beginner"], pairs([
 ("привет","hi","privet"),("спасибо","thank you","spasibo"),("пожалуйста","please; you're welcome","pozhaluysta"),("да","yes","da"),
 ("нет","no","net"),("вода","water","voda"),("дом","house; home","dom"),("кошка","cat","koshka"),("собака","dog","sobaka"),
 ("книга","book","kniga"),("стол","table","stol"),("город","city","gorod"),("день","day","den'"),("ночь","night","noch'"),
 ("время","time","vremya"),("друг","friend","drug"),("семья","family","sem'ya"),("работа","work; job","rabota"),("школа","school","shkola"),
 ("еда","food","yeda"),("хлеб","bread","khleb"),("молоко","milk","moloko"),("красный","red","krasnyy"),("синий","(dark) blue","siniy"),
 ("зелёный","green","zelyonyy"),("белый","white","belyy"),("чёрный","black","chyornyy"),("большой","big","bol'shoy"),
 ("маленький","small","malen'kiy"),("хороший","good","khoroshiy"),("плохой","bad","plokhoy"),("новый","new","novyy"),("старый","old","staryy"),
 ("говорить","to speak; to talk","govorit'"),("есть","to eat","yest'"),("пить","to drink","pit'"),("жить","to live","zhit'"),
 ("быть","to be","byt'"),("идти","to go (on foot)","idti"),("делать","to do; to make","delat'"),("хотеть","to want","khotet'"),
 ("знать","to know","znat'"),("любить","to love; to like","lyubit'"),("один","one","odin"),("два","two","dva"),("три","three","tri"),
 ("сегодня","today","segodnya"),("завтра","tomorrow","zavtra"),("вчера","yesterday","vchera"),("здравствуйте","hello (formal)","zdravstvuyte")]))

deck("capitals", "🌍", "Столицы мира", "World capitals (in Russian)",
 "60 стран и их столицы: Европа, Азия, Америка, Африка и Океания.",
 "60 countries and their capitals, in Russian.",
 "ru", "ru", ["geography"], pairs([
 ("Россия","Москва"),("Франция","Париж"),("Германия","Берлин"),("Италия","Рим"),("Испания","Мадрид"),("Португалия","Лиссабон"),
 ("Великобритания","Лондон"),("Ирландия","Дублин"),("Нидерланды","Амстердам"),("Бельгия","Брюссель"),("Швейцария","Берн"),
 ("Австрия","Вена"),("Польша","Варшава"),("Чехия","Прага"),("Венгрия","Будапешт"),("Греция","Афины"),("Турция","Анкара"),
 ("Швеция","Стокгольм"),("Норвегия","Осло"),("Финляндия","Хельсинки"),("Дания","Копенгаген"),("Исландия","Рейкьявик"),
 ("Румыния","Бухарест"),("Болгария","София"),("Сербия","Белград"),("Хорватия","Загреб"),("Украина","Киев"),("Беларусь","Минск"),
 ("Казахстан","Астана"),("Грузия","Тбилиси"),("Армения","Ереван"),("Азербайджан","Баку"),("Узбекистан","Ташкент"),
 ("Монголия","Улан-Батор"),("Китай","Пекин"),("Япония","Токио"),("Южная Корея","Сеул"),("Индия","Нью-Дели"),("Таиланд","Бангкок"),
 ("Вьетнам","Ханой"),("Индонезия","Джакарта"),("Иран","Тегеран"),("Пакистан","Исламабад"),("Саудовская Аравия","Эр-Рияд"),
 ("ОАЭ","Абу-Даби"),("Египет","Каир"),("Марокко","Рабат"),("Нигерия","Абуджа"),("Кения","Найроби"),
 ("ЮАР","Претория","административная столица; у ЮАР их три"),("Австралия","Канберра"),("Новая Зеландия","Веллингтон"),
 ("Канада","Оттава"),("США","Вашингтон"),("Мексика","Мехико"),("Куба","Гавана"),("Бразилия","Бразилиа"),("Аргентина","Буэнос-Айрес"),
 ("Чили","Сантьяго"),("Перу","Лима")]))

els = ["H Водород","He Гелий","Li Литий","Be Бериллий","B Бор","C Углерод","N Азот","O Кислород","F Фтор","Ne Неон","Na Натрий",
 "Mg Магний","Al Алюминий","Si Кремний","P Фосфор","S Сера","Cl Хлор","Ar Аргон","K Калий","Ca Кальций","Sc Скандий","Ti Титан",
 "V Ванадий","Cr Хром","Mn Марганец","Fe Железо","Co Кобальт","Ni Никель","Cu Медь","Zn Цинк"]
deck("elements", "⚗️", "Химические элементы 1–30", "Chemical elements 1–30 (in Russian)",
 "Символы первых 30 элементов таблицы Менделеева и их названия. В подсказке — порядковый номер.",
 "Symbols of the first 30 elements with their Russian names; atomic number as a hint.",
 "ru", "ru", ["chemistry", "science"], [{"front": e.split()[0], "back": e.split()[1], "hint": f"№ {i+1}"} for i, e in enumerate(els)])

json.dump({"version": 1, "decks": decks}, open("catalog.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(len(decks), "decks:", [(d["id"], d["count"]) for d in decks])
