// =====================================================================
//  functions.ink — функции и туннели, подключается из main.ink
// =====================================================================

// Функция с возвратом значения
=== function add_gold(current, amount) ===
~ return current + amount

// Функция, меняющая глобальную переменную
=== function take_damage(amount) ===
~ hp = MAX(hp - amount, 0)
{ hp < 3:
    ~ Mood = scared
}

=== function is_dead() ===
~ return hp <= 0

// Параметр по ссылке (ref) — функция меняет переданную переменную
=== function spend(ref wallet, price) ===
{ wallet >= price:
    ~ wallet -= price
    ~ return true
}
~ return false

// Рекурсия: вывести содержимое инвентаря через запятую
=== function list_items(items) ===
{ LIST_COUNT(items):
    - 0: ничего
    - 1: {items}
    - else: {LIST_MIN(items)}, {list_items(items - LIST_MIN(items))}
}

// Туннель: вызывается как `-> inventory_screen ->`, возвращается через `->->`
=== inventory_screen ===
В сумке: {list_items(inventory)}.
{ inventory ? (torch, rope):
    С факелом и верёвкой можно и в пещеру.
}
->->
