// =====================================================================
//  main.ink: entry point. The other files are pulled in with INCLUDE
//  (paths are relative to this file).
// =====================================================================

INCLUDE functions.ink
INCLUDE tavern.ink

// ---------- Global state ----------
CONST MAX_HP = 10                   // constant
VAR hp = MAX_HP                     // number
VAR gold = 5
VAR name = "Wanderer"               // string
VAR has_torch = false               // bool
VAR last_place = -> start           // divert variable (a reference to a knot)

// LIST: an enumeration / a set of states
LIST Mood = calm, (curious), scared // (curious) is the initial value
LIST Items = torch, rope, key, coin
VAR inventory = (rope)              // a list value: a set of flags

# title: Demo story
# author: you

-> start

// ---------- Knot ----------
=== start ===
~ last_place = -> start
You stand at a crossroads. {Dusk is falling.|It is quite dark now.|Night.}   // sequence: changes on every visit
Health: {hp}/{MAX_HP}, gold: {gold}. Mood: {Mood}.

// * is a one-time choice, + is "sticky" and always stays
// [..] is text shown only on the button, not in the continuation
* [Introduce yourself]
    What is your name?
    ** "Alex"[] you answer.
       ~ name = "Alex"
    ** "None of your business"[] you snap.
       ~ Mood = scared
    -- (introduced) Name: {name}.   // nested gather with a label
    -> start
+ {not has_torch} [Look for a torch]           // conditional choice
    -> find_torch
* {has_torch} [Enter the dark forest]
    -> forest
+ [Go to the tavern] -> tavern
+ [Check your inventory]
    -> inventory_screen -> start               // call a tunnel and come back here

// ---------- Stitches inside a knot ----------
=== find_torch ===
= search
You rummage through the bushes.
~ temp found = RANDOM(1, 3)                 // local temporary variable
{
    - found == 1:
        Nothing... -> search_again
    - else:
        -> got_it
}

= search_again
{&Thorns prick you.|An owl hoots somewhere.|Only wet leaves.}   // cycle
+ [Keep searching] -> search
+ [Give up] -> start

= got_it
You found a torch!
~ has_torch = true
~ inventory += torch
-> start

// ---------- Conditions, switch, a loop through a gather ----------
=== forest ===
~ last_place = -> forest
// Multi-line if/else
{ Mood == scared:
    Your hands shake, the torch dances.
- else:
    You walk forward with confidence.
}

// A switch-like block on a value
{ gold:
    - 0: Your purse is empty.
    - 1: A single coin jingles in your pocket.
    - else: Coins jingle: {gold} of them.
}

// A loop: a labelled gather and a divert back to it, counting visits
- (deeper)
You go deeper into the forest (step {deeper}). {~A branch cracks.|A bat flies past.|Silence.}   // shuffle
{ deeper >= 3:
    -> clearing
}
+ [Further] -> deeper
+ {deeper > 1} [Turn back] -> start
* -> clearing       // fallback choice without text: fires when nothing else is left

=== clearing ===
A chest stands in the clearing.
* {inventory has key} [Open it with the key]
    Inside: {~a bag of gold|an old map}.
    ~ gold = add_gold(gold, 10)
    -> ending
* [Break the lock]
    ~ take_damage(3)
    The lock clicks, but you cut yourself. HP: {hp}.
    { is_dead():
        -> death
    }
    -> ending
* [Walk away] -> ending

=== death ===
You collapse. # style: bad
-> END

=== ending ===
// Multi-branch if: every branch starts with "- condition:"
{
    - gold >= 15: You return rich, {name}!
    - gold > 5:   A decent haul.
    - else:       At least you are alive.
}
You spent {TURNS_SINCE(-> forest)} turns in the forest and visited the tavern {tavern} times.
-> END
