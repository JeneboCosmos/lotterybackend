const db = require('../config/db');

const getSalesSummary = async (req, res) => {
  try {
    const connection = await db.getConnection();

    // 1. Sales for all time: Gross, Net, Wins
    const [sales] = await connection.execute(`
      SELECT
        SUM(price) AS gross_sales,
        SUM(CASE WHEN is_winner = 1 THEN price ELSE 0 END) AS winning_payouts,
        (SUM(price) - SUM(CASE WHEN is_winner = 1 THEN price ELSE 0 END)) AS net_sales

      FROM play
    `);

    // 2. Tickets sold (count)
    const [tickets] = await connection.execute(`
      SELECT COUNT(*) AS tickets_sold FROM play
    `);

    // 3. Top writers by sales amount (top 5)
    const [topWriters] = await connection.execute(`
      SELECT u.user_id, u.username, SUM(p.price) AS total_sales, COUNT(p.play_id) AS tickets_sold
      FROM play p
      JOIN users u ON p.user_id = u.user_id
      GROUP BY u.user_id, u.username
      ORDER BY total_sales DESC
      LIMIT 5
    `);

    // 4. Games histogram: number of tickets sold per game
    const [gamesHistogram] = await connection.execute(`
      SELECT g.game_id AS game_id, g.game_name AS game_name, COUNT(p.play_id) AS tickets_sold
      FROM play p
      JOIN games g ON p.game_id = g.game_id
      GROUP BY g.game_id, g.game_name
      ORDER BY tickets_sold DESC
    `);

    connection.release();

    res.json({
      sales: sales[0],
      tickets: tickets[0].tickets_sold,
      topWriters,
      gamesHistogram
    });
  } catch (error) {
    console.error('Error fetching sales summary:', error);
    res.status(500).json({ message: 'Error fetching sales summary', error: error.message });
  }
};

const getTopAgents = async (req, res) => {
  try {
    const connection = await db.getConnection();

    const [topAgents] = await connection.execute(`
      SELECT 
        a.user_id AS agent_id,
        a.username AS agent_name,
        COALESCE(SUM(p.price), 0) AS total_sales,
        COUNT(p.play_id) AS tickets_sold
      FROM play p
      JOIN users w ON p.user_id = w.user_id
      JOIN users a ON w.agent_id = a.user_id
      GROUP BY a.user_id, a.username
      ORDER BY total_sales DESC
      LIMIT 5
    `);

    connection.release();

    res.json({ topAgents });
  } catch (err) {
    console.error('Error fetching top agents:', err);
    res.status(500).json({
      message: 'Error fetching top agents',
      error: err.message,
    });
  }
};

// Existing agent-platform summary
const getAgentPlatformSummary = async (req, res) => {
  const agent_id = req.query.agent_id?.trim();
  const platform_id = req.query.platform_id?.trim();

  if (!agent_id || !platform_id) {
    return res.status(400).json({ message: 'agent_id and platform_id are required' });
  }

  try {
    const connection = await db.getConnection();

    // 1. Count total writers
    const [writerCount] = await connection.execute(
      `
      SELECT COUNT(*) AS total_writers 
      FROM users 
      WHERE agent_id = ? AND platform_id = ?
    `,
      [agent_id, platform_id]
    );

    // 2. Sales summary + ticket count
    const [summary] = await connection.execute(
        `
        SELECT
          COUNT(p.play_id) AS tickets_sold,
          COALESCE(SUM(p.price), 0) AS gross_sales,
          COALESCE(SUM(CASE WHEN p.is_winner = 1 THEN p.price ELSE 0 END), 0) AS winning_payouts,
          (COALESCE(SUM(p.price), 0) - COALESCE(SUM(CASE WHEN p.is_winner = 1 THEN p.price ELSE 0 END), 0)) AS net_sales
        FROM play p
        JOIN users w ON p.user_id = w.user_id
        WHERE w.agent_id = ? AND w.platform_id = ?
        `,
        [agent_id, platform_id]
      );

    connection.release();

    res.json({
      agent_id,
      platform_id,
      gross_sales: summary[0].gross_sales,
      net_sales: summary[0].net_sales,
      winning_payouts: summary[0].winning_payouts,
      tickets_sold: summary[0].tickets_sold,
      total_writers: writerCount[0].total_writers
    });
  } catch (error) {
    console.error('Error fetching agent platform summary:', error);
    res.status(500).json({
      message: 'Error fetching agent platform summary',
      error: error.message
    });
  }
};


// ✅ NEW endpoint: Get top 5 writers for an agent on a particular platform
const getTopWritersOfAgentPlatform = async (req, res) => {
  const agent_id = req.query.agent_id?.trim();
  const platform_id = req.query.platform_id?.trim();

  if (!agent_id || !platform_id) {
    return res.status(400).json({ message: 'agent_id and platform_id are required' });
  }

  try {
    const connection = await db.getConnection();

    // Get top 5 writers (users) who belong to agent & platform with their total sales & tickets
    const [topWriters] = await connection.execute(`
      SELECT 
        u.user_id,
        u.username,
        COALESCE(SUM(p.price), 0) AS total_sales,
        COUNT(p.play_id) AS tickets_sold
      FROM users u
      LEFT JOIN play p ON u.user_id = p.user_id
      WHERE u.agent_id = ? AND u.platform_id = ?
      GROUP BY u.user_id, u.username
      ORDER BY total_sales DESC
      LIMIT 5
    `, [agent_id, platform_id]);

    connection.release();

    res.json({
      agent_id,
      platform_id,
      topWriters
    });
  } catch (error) {
    console.error('Error fetching top writers of agent platform:', error);
    res.status(500).json({
      message: 'Error fetching top writers of agent platform',
      error: error.message
    });
  }
};

const getAllWritersOfAgent = async (req, res) => {
  const agent_id = req.query.agent_id?.trim();
  const platform_id = req.query.platform_id?.trim(); // Optional

  if (!agent_id) {
    return res.status(400).json({ message: 'agent_id is required' });
  }

  try {
    const connection = await db.getConnection();

    // Query all writers assigned to the agent (and optionally filter by platform)
    let query = `
      SELECT user_id, username, platform_id
      FROM users
      WHERE agent_id = ?
    `;
    const params = [agent_id];

    if (platform_id) {
      query += ` AND platform_id = ?`;
      params.push(platform_id);
    }

    const [writers] = await connection.execute(query, params);

    connection.release();

    res.json({
      agent_id,
      platform_id: platform_id || null,
      total_writers: writers.length,
      writers
    });
  } catch (error) {
    console.error('Error fetching writers of agent:', error);
    res.status(500).json({
      message: 'Error fetching writers of agent',
      error: error.message
    });
  }
};


module.exports = {
  getSalesSummary,
  getAllWritersOfAgent,

  getTopAgents,
  getAgentPlatformSummary,
  getTopWritersOfAgentPlatform // <-- export new endpoint here
};
