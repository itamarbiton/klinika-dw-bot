const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Telegraf = require('telegraf')
const Extra = require('telegraf/extra');
const Markup = require('telegraf/markup');

// authenticate so we can access services
admin.initializeApp();

// get a reference to firestore
let db = admin.firestore();

// load the configuration file that contains the Telegram bot token
let config = require('./env.json');
if (Object.keys(functions.config()).length) config = functions.config();

const start_message = `ברוך הבא עבד צעיר!\nהגעת לבוט התורנויות של הקליניקה, הלא היא דירה 2, בן יהודה 48 א׳, תל אביב-יפו`;

async function findTask(taskId) {
  let taskQueryRef = db.collection('mesimot').where('id', '==', taskId);
  let taskQuerySnapshot;
  try {
    taskQuerySnapshot = await taskQueryRef.get();
  } catch (err) {
    throw err;
  }

  if (taskQuerySnapshot.docs.length === 0) {
    throw new Error(`could not find task with identifier ${taskId}`)
  }

  let taskDocSnapshot = taskQuerySnapshot.docs[0]
  return { snapshpt: taskDocSnapshot, data: taskDocSnapshot.data() };
}

async function findUser(userId) {
  let userRef = db.collection('users').doc(userId);

  let userSnapshot;
  try {
    userSnapshot = await userRef.get();
  } catch (err) {
    throw err;
  }

  if (!userSnapshot.exists) throw new Error('failed to find a user with the supplied identifier');
  return { snapshot: userSnapshot, data: userSnapshot.data() };
}

async function rotateTask(task, taskId) {
  if (task.rotation === undefined) {
    return console.log(`task ${task.name} was not initialized yet, did not rotate`);
  }

  if (task.currentIndex === task.rotation.length - 1) {
    task.currentIndex = 0
  } else {
    task.currentIndex += 1;
  }
  task.rotateLastUpdate = new Date();

  try {
    await db.collection('mesimot').doc(taskId).set(task);
  } catch (err) {
    return console.log(`failed to update task with identifier ${taskId}`);
  }

  return undefined;
}

async function handleRotation(ctx = undefined) {
  let tasksQuerySnapshot;
  try {
    tasksQuerySnapshot = await db.collection('mesimot').get();
  } catch (err) {
    return console.log(`failed to get tasks from database ${err}`);
  }

  let rotatePromises = tasksQuerySnapshot.docs.map(docSnapshot => rotateTask(docSnapshot.data(), docSnapshot.id));

  try {
    let results = await Promise.all(rotatePromises);
    console.log(results);
  } catch (err) {
    return console.log(`failed to rotate tasks, ${err}`);
  }

  if (ctx !== undefined) {
    ctx.reply(`סיבוב תורנויות בוצע בהצלחה!`);
  }

  return undefined;
}

async function handleInform() {
  let tasksQuerySnapshot;
  try {
    tasksQuerySnapshot = await db.collection('mesimot').get();
  } catch (err) {
    return console.log(`failed to get tasks from database, ${err}`);
  }

  for (const taskDocSnapshot of tasksQuerySnapshot.docs) {
    let task = taskDocSnapshot.data();

    if (task.rotation === undefined) {
      console.log(`the task ${task.name} was not initialized yet, did not inform`);
      continue;
    }

    let assigneeId = task.rotation[task.currentIndex];
    let informMsgStr = `בוקר טוב, היום תורך במשימה *״${task.name}״*, דיר בלאק...`;
    bot.telegram.sendMessage(assigneeId, informMsgStr, Extra.markup().markdown())
  }

  return undefined;
}

async function handleStart(ctx) {
  let senderId = ctx.from.id.toString();
  let userDocRef = db.collection('users').doc(senderId);

  try {
    await userDocRef.set({
      chatId: ctx.chat.id,
      firstName: ctx.from.first_name
    });
  } catch (err) {
    return console.log('failed to register user in the database, ' + err);
  }

  ctx.reply(start_message);
  return undefined;
}

async function handleMesimot(ctx) {
  let tasksRef = db.collection('mesimot')

  let tasksSnapshot;
  try {
    tasksSnapshot = await tasksRef.get();
  } catch (err) {
    return console.log('failed to get tasks from database, ' + err);
  }

  let tasks = tasksSnapshot.docs.map(docSnapshot => docSnapshot.data());
  let sortedTasks = tasks.sort((taskA, taskB) => taskA.id > taskB.id);
  let taskDescriptionArr = sortedTasks.map(task => `(${task.id}) ${task.name}`);
  let replyMsgStr = taskDescriptionArr.join('\n');

  ctx.reply(replyMsgStr);
  return undefined;
}

async function handleAni(ctx) {
  let senderId = ctx.from.id.toString();

  let user;
  try {
    const result = await findUser(senderId);
    user = result.data;
  } catch (err) {
    return console.log('failed to find a user with the supplied identifier');
  }

  let userName = user.displayName || user.firstName;
  let replyMsgStr = `שם התצוגה שלך הוא *${userName}*`;

  ctx.reply(replyMsgStr, Extra.markup().markdown());
  return undefined;
}

async function handleShem(ctx) {
  let messageParts = ctx.message.text.split(' ');
  let nameParts = messageParts.slice(1);

  if (nameParts.length === 0) {
    ctx.reply('כדי לשנות שם יש להוסיף את השם החדש לאחר הפקודה /shem');
    return console.log('failed to get the user\'s new name');
  }

  let newName = nameParts.join(' ');
  let senderId = ctx.from.id.toString();

  let snapshot;
  let user;
  try {
    const result = await findUser(senderId);
    snapshot = result.snapshot;
    user = result.data;
  } catch (err) {
    return console.log(`failed to find user with identifier ${senderId}, ${err}`);
  }

  user.displayName = newName;

  try {
    await db.collection('users').doc(senderId).set(user);
  } catch (err) {
    return console.log(`failed to update the user's name, ${err}`);
  }

  ctx.reply(`השם שלך שונה בהצלחה ל-*${newName}*`, Extra.markup().markdown());
  return undefined;
}

async function handleAvadim(ctx) {
  let msgText = ctx.message.text;
  let msgParts = msgText.split(' ');
  let taskId = parseInt(msgParts[1]);

  if (taskId === undefined || isNaN(taskId)) {
    ctx.reply('יש לצרף מספר משימה, כדי לראות את המשימות הזמינות הקלד /mesimot');
    return console.log('failed to get the tasks identifier');
  }

  let snapshot;
  let task;
  try {
    const result = await findTask(taskId);
    snapshot = result.snapshpt;
    task = result.data;
  } catch (err) {
    ctx.reply(`לא נמצאה משימה עם המספר המבוקש, לצפייה ברשימת המשימות שלח /mesimot`);
    return console.log(`failed to find task with identifier ${taskId}`);
  }

  let assigneeIds = Object.keys(task.assignees);
  let assigneeRefs = assigneeIds.map(assigneeId => db.collection('users').doc(assigneeId));

  let assigneeDocSnapshots;
  try {
    assigneeDocSnapshots = await Promise.all(assigneeRefs.map(ref => ref.get()));
  } catch (err) {
    return console.log(`failed to get assignees from database, ${err}`);
  }

  assigneeDocSnapshots = assigneeDocSnapshots.filter(docSnapshot => docSnapshot.exists);
  let assignees = assigneeDocSnapshots.map(docSnapshot => docSnapshot.data());
  let assigneeDescArr = assignees.map(assignee => `👷🏻‍♂️ ${assignee.displayName || assignee.firstName}`);

  let msgTitleStr = `להלן רשימת העבדים עבור המשימה ״${task.name}״ -\n`;
  let replyMsgStr = msgTitleStr + assigneeDescArr.join('\n');

  ctx.reply(replyMsgStr);
  return undefined;
}

async function handleAniEved(ctx) {
  let msgParts = ctx.message.text.split(' ');
  let taskId = parseInt(msgParts[1]);
  let senderId = ctx.from.id.toString();

  if (isNaN(taskId)) {
    ctx.reply(`יש להכניס מספר משימה, לקבלת המשימות הזמינות שלח /mesimot`);
    return console.log(`did not receive task identifier`);
  }

  let snapshot
  let task;
  try {
    const result = await findTask(taskId);
    snapshot = result.snapshpt;
    task = result.data;
  } catch (err) {
    ctx.reply(`לא נמצאה משימה עם המספר המבוקש, לצפייה ברשימת המשימות שלח /mesimot`);
    return console.log(`failed to find task with identifier ${taskId}`);
  }

  task.assignees[senderId] = true

  try {
    await db.collection('mesimot').doc(snapshot.id).set(task);
  } catch (err) {
    return console.log(`failed to update task with identifier ${taskId}, ${err}`);
  }

  ctx.reply(`נרשמת בהצלחה למשימה "${task.name}"`);
  return undefined;
}

async function createTaskSikumString(task) {
  if (task.rotation === undefined) {
    return `🔴 המשימה ״${task.name}״ *טרם אותחלה*`;
  }

  let assigneeId = task.rotation[task.currentIndex];

  let snapshot;
  let assignee;
  try {
    const result = await findUser(assigneeId);
    snapshot = result.snapshot;
    assignee = result.data;
  } catch (err) {
    throw new Error(`failed to find user with identifier ${assigneeId}, ${err}`);
  }

  return `⚪️ התורן היומי למשימה ״${task.name}״ הוא *${assignee.displayName || assignee.firstName}*`;
}

async function handleSikum(ctx) {
  let tasksCollectionRef = db.collection('mesimot');

  let tasksQuerySnapshot;
  try {
    tasksQuerySnapshot = await tasksCollectionRef.get();
  } catch (err) {
    return console.log(`failed to get the list of tasks from the databse, ${err}`);
  }

  let tasks = tasksQuerySnapshot.docs
    .filter(snapshot => snapshot.exists)
    .map(snapshot => snapshot.data());

  let tasksDescArr;
  try {
    tasksDescArr = await Promise.all(tasks.map(task => createTaskSikumString(task)));
  } catch (err) {
    return console.log(`failed to create task descriptions, ${err}`);
  }

  let msgTitleStr = `להלן סיכום המשימות היומי -\n`;
  let replyMsgStr = msgTitleStr + tasksDescArr.join(`\n`);
  ctx.reply(replyMsgStr, Extra.markup().markdown());
  return undefined;
}

async function handleYalla(ctx) {
  let messageParts = ctx.message.text.split(' ');
  let taskId = parseInt(messageParts[1]);

  if (isNaN(taskId)) {
    ctx.reply('יש להעביר את מספר המשימה, למשימות הזמינות שלח /mesimot');
    return console.log('no task identifier was received')
  }

  let snapshot;
  let task;
  try {
    const result = await findTask(taskId);
    snapshot = result.snapshpt;
    task = result.data;
  } catch (err) {
    ctx.reply(`לא נמצאה משימה עם המספר המבוקש, לרשימת המשימות שלח /mesimot`);
    return console.log(`failed to find task with identifier ${taskId}, ${err}`);
  }

  if (Object.keys(task.assignees).length === 0) {
    ctx.reply('לא ניתן להתחיל משימה שלא נרשמה אליה עבדים!');
    return conslog.log('can\'t start a task without assignees');
  }

  task.rotation = Object.keys(task.assignees);
  task.currentIndex = 0
  task.rotateLastUpdate = new Date();

  try {
    await db.collection('mesimot').doc(snapshot.id).set(task);
  } catch (err) {
    return console.log(`failed to initialize task with identifier ${taskId}`);
  }

  ctx.reply('המשימה אותחלה בהצלחה!');
  return undefined;
}

const bot = new Telegraf(config.service.telegram_bot_token);

bot.start(async (ctx) => await handleStart(ctx));
bot.command('mesimot', async (ctx) => await handleMesimot(ctx));
bot.command('ani', async (ctx) => await handleAni(ctx));
bot.command('shem', async (ctx) => await handleShem(ctx));
bot.command('avadim', async (ctx) => await handleAvadim(ctx));
bot.command('anieved', async (ctx) => await handleAniEved(ctx));
bot.command('sikum', async (ctx) => await handleSikum(ctx));
bot.command('dorotate', async (ctx) => handleRotation(ctx));
bot.command('doinform', async (ctx) => handleInform());
bot.command('yalla', async (ctx) => handleYalla(ctx));

// bot.launch();

exports.botHandler = functions.https.onRequest(async (req, res) => {
  try {
    await bot.handleUpdate(req.body, res)
    if (!res.writableEnded) {
      res.end();
    }
  } catch (err) {
    res.status(500).send('something went wrong');
  }
});