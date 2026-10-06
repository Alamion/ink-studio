// =====================================================================
//  tavern.ink: a dialogue with a loop, glue, threads and tags
// =====================================================================

=== tavern ===
~ last_place = -> tavern
{ tavern > 1: You again. | Welcome!} shouts the innkeeper. # speaker: Innkeeper

// Thread: mix the choices of another knot into the current list
<- tavern_regulars

- (bar_loop)
// once-only: every phrase appears once, then nothing
{!The air smells of ale.|A dog sleeps by the fireplace.|}
+ {gold >= 2} [Buy an ale (2 gold)]
    { spend(gold, 2):
        You drink the ale. <>
    }
    // <> glue joins lines without a break
    {gold} gold left.
    -> bar_loop
+ {inventory !? key} [Ask about the key]
    "A key? A coin will loosen my tongue." # speaker: Innkeeper
    ++ {gold > 0} [Give a coin]
        ~ gold--
        ~ inventory += key
        He hands you a rusty key.
    ++ [Decline]
        "Suit yourself."
    -- -> bar_loop
+ [Leave] -> start

// The choices of this knot are added to the tavern through <- (thread)
=== tavern_regulars ===
* [Play dice with the regulars]
    ~ temp roll = RANDOM(1, 6)
    You roll {roll}.
    { roll > 3:
        ~ gold += 3
        You win!
    - else:
        ~ take_damage(1)
        You lose and get a cuff. HP: {hp}.
    }
    -> tavern.bar_loop
