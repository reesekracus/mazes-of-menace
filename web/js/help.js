// In-app Help (touch version). Faithful to vanilla NetHack: how to use the controls and the basic rules,
// no spoilers beyond the Guidebook. Use the app's button names, never key letters.
// Format: blank line = new paragraph, "- " = bullet, **bold**.
export const HELP = [
  {
    id: 'controls', title: 'Controls',
    text: `
**The map**
- Tap a square to walk there. You stop if something interesting happens on the way.
- Long-press a square to look at what's there.
- Drag to move the view. Pinch, or use + and −, to zoom. ◎ centres the view on you again.

**Moving**
- Arrow pad: tap to take one step, hold to run in that direction.
- The middle button searches your surroundings once. Hold it to search 20 times in a row (this also passes time, which lets you rest).

**Buttons**
- The buttons along the bottom are common commands. **More** opens every command, with a search box.
- You can choose which commands are on the buttons: Settings → Customize the action buttons.
- Buttons also appear over the map for what you're standing on (stairs, a fountain, items…) and for closed doors next to you. **More…** there lists everything you can do on that square.

**Messages and questions**
- Messages show at the top. Tap them to read the message history.
- When "▼ tap to continue" shows, tap anywhere.
- When a command needs an item, a list of suitable items opens. When it needs a direction, arrows appear: **Self** means yourself, **Up** and **Down** mean up or down (for example through stairs).`,
  },
  {
    id: 'status', title: 'Reading the status lines',
    text: `
**Line 1:** your name and rank, your alignment, and warnings such as Hungry, Burdened, Blind or Conf (confused).

**Line 2:** your attributes, then where you are.
- St Strength, Dx Dexterity, Co Constitution, In Intelligence, Wi Wisdom, Ch Charisma.
- Dlvl is the dungeon level. Higher numbers are deeper.

**Line 3:**
- **HP** hit points, current (maximum). At 0 you die. Green is fine, yellow is hurt, red is in danger. The panel gets a red edge when HP is low, and the phone vibrates when you take damage (Settings can turn that off).
- **Pw** power, used to cast spells.
- **AC** armor class. Lower is better, and it can go below zero.
- **Xp** experience level / experience points.
- **T** turns played. **$** gold.`,
  },
  {
    id: 'stuck', title: 'Stuck? Locked doors and hidden routes',
    text: `
Every level can be finished. If you can't find a way forward, it's one of two things.

**A locked door** ("This door is locked.")
- Kick it: tap **Kick**, then the arrow pointing at the door. It can take several tries ("WHAMM!"). Keep going until it crashes open or breaks.
- Or unlock it: if you have a key, lock pick or credit card, use **Apply** on it, then pick the door's direction. It's quieter and doesn't break the door.
- Kicking makes noise and can wake nearby monsters.
- Shops: don't kick a shop door. "Closed for inventory" means the shopkeeper is inside and the shop is closed. Leave it alone.

**A hidden route** (a room with no exits, or a corridor that just stops)
- Levels are always connected, but sometimes only through a secret door or secret corridor.
- Stand next to the dead end or wall and hold the middle arrow-pad button to search 20 times. Repeat if nothing turns up.

Rule of thumb: a "locked" message means kick or unlock. A dead end with no door at all means search.`,
  },
  {
    id: 'hunger', title: 'Eating and hunger',
    text: `
You use up food as you play. When **Hungry** shows on the status line, eat something: tap **Eat** and choose from the list.

- If you ignore hunger you become Weak, then start Fainting, and finally starve.
- Don't keep eating when you're Satiated. Overeating can make you choke.
- The food you start with is safe to eat.
- You can eat the corpse of a monster you killed: stand on it and tap **Eat**. Fresh corpses are safest. Corpses go bad after a while, and some monsters are harmful to eat. When in doubt, eat your own food.
- Eating takes time, and a monster can interrupt you.`,
  },
  {
    id: 'fighting', title: 'Fighting',
    text: `
- Attack a monster by moving into it with the arrow pad.
- Long-press a monster first to see what it is.
- **Fire** shoots or throws whatever is in your quiver (arrows, daggers…). **Throw** throws anything else.
- Some monsters are peaceful. If you move into one, the game asks whether you really want to attack. Usually say No: attacking peaceful monsters is rarely a good idea.
- Your pet (marked with a heart) fights on your side. Moving into it swaps places with it.
- Running away is often the right call. When HP are low, get away and rest by holding the middle arrow-pad button. In a real emergency, see Praying.`,
  },
  {
    id: 'praying', title: 'Praying',
    text: `
Your god may help you when you're in serious trouble, for example when your HP are very low or you're Weak from hunger. Use **Pray** (in More, or add it to your buttons). The game asks you to confirm.

- Praying too often angers your god. Save it for real emergencies and leave a long time between prayers.
- Praying when you're not in trouble is risky.
- An altar matches one god. **Offer** lets you sacrifice fresh corpses of monsters you killed there.`,
  },
  {
    id: 'items', title: 'Items and inventory',
    text: `
- When you stand on items, tap **Pick up**. Auto-pickup (title screen → Pet, fruit and auto-pickup) can pick up gold and small items by itself.
- **Inventory** lists what you carry. Tap an item to see what you can do with it.
- Use **Wear** for armor, **Wield** for weapons, **Put on** for rings and amulets.
- Many items aren't identified at first. Potions, scrolls, wands and rings only show how they look ("a bubbly potion") until you learn what they are, for example by using one. **Name** (in More) lets you give an item type a name to help you remember it. **Discoveries** lists what you've identified.
- Carrying too much makes you Burdened, which slows you down, and heavier loads are worse. Drop what you don't need.
- Shops: pick up an item to hear its price and use **Pay** to buy it. Drop your own items in a shop to sell them.`,
  },
  {
    id: 'levels', title: 'Stairs, levels and the goal',
    text: `
Your quest: go down through the dungeon, find the Amulet of Yendor deep below, and bring it back up to offer to your god.

- When you stand on stairs, **Go down** or **Go up** appears. Ladders work the same way.
- Your pet comes along only if it's right next to you when you take the stairs.
- Going up the stairs on level 1 leaves the dungeon and ends the game. The game asks first.
- **Dungeon overview** (in More) lists the levels you've visited and what you found there.`,
  },
  {
    id: 'saving', title: 'Saving and your games',
    text: `
- The game saves itself when you leave the app. When you come back, you pick up where you left off.
- **Save and quit** (in More) saves and returns to the title screen. Tap **Continue** there to keep playing.
- Death is permanent: when your character dies, the saved game is gone. That's how NetHack is played.
- Each name has one saved game. Use a different name to start another game alongside it.
- **Past games** (title screen) shows NetHack's full summary of each finished game, which you can share.
- **Back up saves** makes a file of your saved games and summaries to keep somewhere safe or move to another phone. **Restore a backup** loads it back.`,
  },
];
