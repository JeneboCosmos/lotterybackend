const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();


const transactionRoutes = require('./routes/transactionRoutes');
const authRoutes = require('./routes/authRoutes');
const resultRoutes = require('./routes/resultRoutes');
const gameRoutes = require('./routes/gameRoutes');
const userRoutes = require('./routes/userRoutes');
const combinationRoutes = require('./routes/combinationRoutes');
const lotteryPlayRoutes = require('./routes/lotteryPlayRoutes');
const playRoutes = require('./routes/playRoutes');
const gameCombinationRoutes = require('./routes/gameCombinationRoutes');
const drawRoutes = require('./routes/drawRoutes');
const winRoutes = require('./routes/winRoutes');
const approveRoutes = require('./routes/approveRoutes');
const moneyRoutes = require('./routes/moneyRoutes'); // ✅ import the money routes
const platformRoutes = require('./routes/platformRoutes'); // path to this file
const salesRoutes = require('./routes/salesRoutes');
const commissionRoutes = require('./routes/commissionRoutes');
const posDeviceRoute = require('./routes/posDeviceRoute');
const topupRoute = require('./routes/topupRoute');
const histogramRouters = require("./routes/histogramRoutes");







const app = express();
const PORT = 4000;

app.use(cors());
app.use(bodyParser.json());



app.use('/api', transactionRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/results', resultRoutes);
app.use('/api/', userRoutes);
app.use('/api/combinations', combinationRoutes);
app.use('/api/lottery-plays', lotteryPlayRoutes);
app.use('/api/game-combinations', gameCombinationRoutes);
app.use('/api/plays', playRoutes);
app.use('/api/draws', drawRoutes);
app.use('/api/win', winRoutes);
app.use('/api/money', moneyRoutes);
app.use('/api', approveRoutes);
app.use('/api/platforms', platformRoutes);
app.use('/api', salesRoutes);
app.use('/api', commissionRoutes);
app.use('/api', topupRoute);
app.use('/api/pos-devices', posDeviceRoute);

app.use("/api/histogram", histogramRouters);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
