// =====================================================================
//  functions.ink: functions and tunnels, included from main.ink
// =====================================================================

// A function that returns a value
=== function add_gold(current, amount) ===
~ return current + amount

// A function that changes a global variable
=== function take_damage(amount) ===
~ hp = MAX(hp - amount, 0)
{ hp < 3:
    ~ Mood = scared
}

=== function is_dead() ===
~ return hp <= 0

// A parameter by reference (ref): the function changes the variable it is given
=== function spend(ref wallet, price) ===
{ wallet >= price:
    ~ wallet -= price
    ~ return true
}
~ return false

// Recursion: print the inventory separated by commas
=== function list_items(items) ===
{ LIST_COUNT(items):
    - 0: nothing
    - 1: {items}
    - else: {LIST_MIN(items)}, {list_items(items - LIST_MIN(items))}
}

// A tunnel: called as `-> inventory_screen ->`, returns through `->->`
=== inventory_screen ===
In your bag: {list_items(inventory)}.
{ inventory ? (torch, rope):
    With a torch and a rope you could even enter the cave.
}
->->
