const express = require('express');
const router = express.Router();
const db = require('../config/db'); // Assumes MySQL2 with db.getConnection()
const combinationMap = {
  1: 'direct1',
  2: 'direct2',
  3: 'direct3',
  4: 'direct4',
  5: 'direct5',
  6: 'perm2',
  7: 'perm3',
  8: 'banker1'
};


const getCombinations = (arr, k) => {
  const result = [];
  const helper = (start, comb) => {
    if (comb.length === k) {
      result.push([...comb]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      comb.push(arr[i]);
      helper(i + 1, comb);
      comb.pop();
    }
  };
  helper(0, []);
  return result;
};

const isSubset = (subset, superset) => {
  return subset.every(n => superset.includes(n));
};

router.post('/', async (req, res) => {
  const { draw_date, numbers } = req.body;

  if (!numbers || numbers.length !== 5) {
    return res.status(400).json({ message: "Provide 5 winning numbers" });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // Insert draw
    const [drawResult] = await conn.execute(
      "INSERT INTO draw (draw_date, numbers) VALUES (?, ?)",
      [draw_date, JSON.stringify(numbers)]
    );
    const drawId = drawResult.insertId;

    // Get all plays
    const [plays] = await conn.execute("SELECT * FROM play");

    const winners = [];
    const drawNumbers = numbers.map(Number);

    for (let play of plays) {
      let userNumbers = [];
      try {
        userNumbers = JSON.parse(play.numbers || '[]');
      } catch (e) {
        console.warn(`Invalid numbers JSON for play ID ${play.play_id}`);
        continue;
      }

      let win = false;
      let winType = '';

      //const gameType = String(play.combination_id || '').toLowerCase();
      const gameType = combinationMap[play.combination_id];

if (!gameType) {
  console.warn(`Unknown combination_id: ${play.combination_id}`);
  continue; // Skip this play
}


      switch (combination_id) {
        case 'direct1':
          if (userNumbers.length === 1 && userNumbers[0] === drawNumbers[0]) {
            win = true;
            winType = 'Direct1';
          }
          break;

        case 'direct2':
          if (userNumbers.length === 2 && isSubset(userNumbers, drawNumbers)) {
            win = true;
            winType = 'Direct2';
          }
          break;

        case 'direct3':
          if (userNumbers.length === 3 && isSubset(userNumbers, drawNumbers)) {
            win = true;
            winType = 'Direct3';
          }
          break;

        case 'direct4':
          if (userNumbers.length === 4 && isSubset(userNumbers, drawNumbers)) {
            win = true;
            winType = 'Direct4';
          }
          break;

        case 'direct5':
          if (userNumbers.length === 5 && isSubset(userNumbers, drawNumbers)) {
            win = true;
            winType = 'Direct5';
          }
          break;

        case 'perm2':
          if (userNumbers.length >= 3) {
            const combos = getCombinations(userNumbers, 2);
            win = combos.some(combo => isSubset(combo, drawNumbers));
            if (win) winType = 'Perm2';
          }
          break;

        case 'perm3':
          if (userNumbers.length >= 4) {
            const combos = getCombinations(userNumbers, 3);
            win = combos.some(combo => isSubset(combo, drawNumbers));
            if (win) winType = 'Perm3';
          }
          break;

        case 'banker1':
          if (userNumbers.length === 1 && drawNumbers.includes(userNumbers[0])) {
            win = true;
            winType = 'Banker1';
          }
          break;

        default:
          console.warn(`Unknown combination_id: ${gameType}`);
      }

      if (win) {
        winners.push([
          play.play_id,
          play.user_id,
          winType,
          100.00 // prize amount
        ]);
      }

      // Update draw_id for this play
      await conn.execute("UPDATE play SET draw_id = ? WHERE id = ?", [drawId, play.id]);
    }

    // Insert winners
    if (winners.length) {
      await conn.query(
        "INSERT INTO winners (play_id, user_id, win_type, prize) VALUES ?",
        [winners]
      );
    }

    await conn.commit();
    res.json({
      message: "Draw created and winners determined",
      drawId,
      winnersCount: winners.length
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
