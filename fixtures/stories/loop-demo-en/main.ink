// =====================================================================
//  loop-demo: a story that is BROKEN ON PURPOSE, to check the loop warning.
//  The "corridor" loops forever without a single choice: players used to hang
//  on it (and take Obsidian down with them). The graph marks such places red.
// =====================================================================

VAR ticks = 0

-> hub

=== hub ===
You are in the middle of a labyrinth.
+ [Walk into the corridor] -> corridor
+ [Listen to the clock] -> clock
+ [Leave] -> END

// A certain hang: corridor -> echo -> corridor, there is no choice.
=== corridor ===
Your steps ring in the dark.
-> echo

=== echo ===
The echo repeats your steps.
-> corridor

// A conditional loop: no choice, but finite (the counter grows).
// The graph marks it as "possible": check that the condition really changes.
=== clock ===
- (tick)
~ ticks++
Tick-tock ({ticks}).
{ ticks % 3 != 0: -> tick }
-> hub
