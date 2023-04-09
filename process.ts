// 파이썬 서브프로세스 spawn, STT 결과 통신 = 307~347번째 줄 exeSTT()
// STT를 제외한 서브프로세스와 통신 = 179~213번째 줄

import { app, BrowserWindow, screen, ipcMain } from "electron";
import path from "path";
import axios from "axios";
import { registerTitlebarIpc } from "@misc/window/titlebarIPC";
import SpeakerAndMike from "@src/functions/SpeakerAndMike";
import FuncIrisSettings from "@misc/window/FuncIrisSettings";
import { spawn } from "child_process";
import iconv from "iconv-lite";
import { kill } from "process";

const fs = require("fs");
const treeKill = require("tree-kill");


// Electron Forge automatically creates these entry points
declare const APP_WINDOW_WEBPACK_ENTRY: string;
declare const RESPONSE_WEBPACK_ENTRY: string;
declare const APP_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const RESPONSE_PRELOAD_WEBPACK_ENTRY: string;

const deployFlag = true; //make 할때는 true, start는 false
const handleIni = new FuncIrisSettings();
const iniPath = !deployFlag
  ? "./src/irisSettings.ini"
  : process.resourcesPath + "/irisSettings.ini";
const exeFilePath = !deployFlag
  ? "src/main/irisSTT-v2/irisSTT.exe"
  : process.resourcesPath + "/irisSTT-v2/irisSTT.exe";

let sttProcess = spawn(exeFilePath);
let prevCommand = "";
let updateCount = 0;

process.setMaxListeners(15);

ipcMain.on("fromMain", (event: any, data: any) => {
  console.log(event);
  console.log(data);
});

let appWindow: BrowserWindow;
export let subWindow: BrowserWindow;

/**
 * Create Application Window
 * @returns {BrowserWindow} Application Window Instance
 */
export function createAppWindow(): BrowserWindow {
  // Create new window instance
  appWindow = new BrowserWindow({
    width: 1152,
    height: 720,
    minWidth: 1152,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: "hidden",
    icon: path.resolve("assets/images/appIcon.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      preload: APP_WINDOW_PRELOAD_WEBPACK_ENTRY,
      sandbox: false,
    },
  });

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  subWindow = new BrowserWindow({
    width: 400,
    height: 200,
    minWidth: 400,
    minHeight: 200,
    maxWidth: 400,
    maxHeight: 200,
    x: width - 400,
    y: height - 200,
    frame: false,
    alwaysOnTop: true, // 항상 위에 위치시키기
    // parent: appWindow,
    show: false,
    autoHideMenuBar: true,
    // titleBarStyle: "hidden",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      preload: RESPONSE_PRELOAD_WEBPACK_ENTRY,
      // 툴바를 하게 해준다.
      sandbox: false,
    },
  });

  // Load the index.html of the app window.
  appWindow.loadURL(APP_WINDOW_WEBPACK_ENTRY);
  subWindow.loadURL(RESPONSE_WEBPACK_ENTRY);
  handleIni.createDefault();

  // Show window when its ready to
  appWindow.on("ready-to-show", () => {
    appWindow.show();
    console.log("update !!");
    if (updateCount == 0) {
      killSTT();
      updateCount++;
    }
  });

  ipcMain.handle("open-sub", () => {
    console.log("open");
    subWindow.show();
    // response 창에 데이터 보내기
    subWindow.webContents.send("stt", text);
  });

  ipcMain.handle("hide-sub", () => {
    subWindow.hide();
  });

  // 음성입력된 텍스트 응답창으로 보내기
  ipcMain.on("send-text", (event, sendText) => {
    subWindow.webContents.send("stt", sendText);
  });

  // 로그인 후 파이썬 실행
  ipcMain.on("user-ini", (event, email, info) => {
    fs.writeFile(iniPath, info, function (err: string) {
      if (err) {
        console.log("Error while writing file:", err);
      } else {
        // STT 실행 !!!
        exeSTT();
      }
    });
  });

  // 프로그램 리스트 요청하기
  ipcMain.on("get-programlist", (event) => {
    console.log("stdin input");
    const command = iconv.encode("5S0I0R0I:::test \n", "euc-kr");
    sttProcess.stdin.write(command);

    const dataListener = (data: any) => {
      const ret = iconv.decode(data, "euc-kr");
      const spltret = ret.split(":::");
      console.log("spltret", spltret);

      console.log(spltret.length > 15);

      if (spltret.length > 15) {
        console.log("get-programlist : ", ret);
        console.log("spltret", spltret);
        event.reply("send-programlist", spltret);
        sttProcess.stdout.off("data", dataListener);
      }
    };

    sttProcess.stdout.on("data", dataListener);
  });

  // ini 파일 default 상태로 바꾸기
  ipcMain.on("make-ini-default", () => {
    handleIni.createDefault();
  });

  // ini 정보 불러오기
  ipcMain.on("get-ini", (event) => {
    const iniData = fs.readFileSync(iniPath, { encoding: "utf8", flag: "r" });
    // console.log(iniData);
    event.reply("send-ini", JSON.parse(iniData.replace(/'/g, '"')));
  });

    // 마이크, 스피커 받아오기
  ipcMain.on("request-data", async (event) => {
    console.log("device request input");
    const command = iconv.encode("1S0I0R0I:::test \n", "euc-kr");
    sttProcess.stdin.write(command);

    const deviceListener = (devices: any) => {
      const ret = iconv.decode(devices, "euc-kr");
      const parseret = parseString(ret);
      const jsonret = JSON.parse(parseret);
      console.log("device jsonret", jsonret);
      if ("tag" in jsonret && jsonret.tag === "I0R0I0S1") {
        const senddata = { mike: jsonret.mike, speaker: jsonret.speaker };
        console.log("enter if");
        event.reply("send-data", senddata);
        sttProcess.stdout.off("data", deviceListener);
      }
    };

    sttProcess.stdout.on("data", deviceListener);
  });

  // 마이크 설정 변경
  ipcMain.on("send-mikeinfo", (event, mikeinfo: string) => {
    console.log("MikeChange start");
    const data = iconv.encode(`4S0I0R0I:::${mikeinfo}\n`, "euc-kr");
    sttProcess.stdin.write(data);
  });

  // 스피커 설정 변경하기
  ipcMain.on("send-speakerinfo", (event, speakerinfo: string) => {
    console.log("SpeakerChange start");
    const data = iconv.encode(`3S0I0R0I:::${speakerinfo}\n`, "euc-kr");
    sttProcess.stdin.write(data);
  });

  // Close all windows when main window is closed
  appWindow.on("close", () => {
    appWindow = null;
    // subWindow = null;
    killSTT();
    app.quit();
  });


  ipcMain.on("logout", async () => {
    // 로그아웃 처리를 하고 로그인 페이지로 이동합니다.
    appWindow.loadURL(APP_WINDOW_WEBPACK_ENTRY);
    handleIni.createDefault();
    console.log("log out!!");
    killSTT();
  });

  // ini 요소 수정
  ipcMain.on("edit-ini", (event, newData, token, action) => {
    console.log("edit-ini", newData, token);
    const iniData = JSON.parse(
      fs.readFileSync(iniPath, { encoding: "utf8", flag: "r" })
    );
    const key = Object.keys(newData)[0];
    if (action === "delete") {
      delete iniData.settings.custom.open[Object.keys(newData.open)[0]];
    } else if (action === "combine") {
      // console.log("namesdfsdfsdfsdfsdfsdfsdfd", typeof newData.name, newData.name)
      // console.log("data", typeof {open: newData.open, close: newData.close, capture: newData.capture}, {open: newData.open, close: newData.close, capture: newData.capture})
      iniData.settings.combine[newData.name] = {
        open: newData.open,
        close: newData.close,
        capture: newData.capture,
      };
    } else if (action === "combinedelete") {
      delete iniData.settings.combine[newData.name];
    } else if (key === "open") {
      if (action === "addURL") {
        iniData.settings.custom.open[
          Object.keys(newData.open)[0]
        ] = `explorer ${newData.open[Object.keys(newData.open)[0]]}`;
      } else {
        iniData.settings.custom.open[Object.keys(newData.open)[0]] =
          newData.open[Object.keys(newData.open)[0]];
      }
    } else {
      iniData.settings[key] = newData[key];
    }

    fs.writeFileSync(iniPath, JSON.stringify(iniData), function (err: string) {
      console.log("default settings save !!");
    });
    const command = iconv.encode("6S0I0R0I:::test \n", "euc-kr");
    sttProcess.stdin.write(command);
    // 여기서 axios 보내기?
    axios({
      method: "put",
      url: "http://j8b102.p.ssafy.io:9000/user/savesettings",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      data: {
        newSettings: JSON.stringify(iniData),
      },
    })
      .then((res) => {
        console.log("success edit ini :)");
      })
      .catch((err) => {
        console.log("fail edit ini :(");
      });
  });

  // Register Inter Process Communication for main process
  registerMainIPC();


  return appWindow;
}

/**
 * Register Inter Process Communication
 */
function registerMainIPC() {
  /**
   * Here you can assign IPC related codes for the application window
   * to Communicate asynchronously from the main process to renderer processes.
   */
  registerTitlebarIpc(appWindow);
}

// STT
function exeSTT() {
  prevCommand == "";
  console.log("exeSTT function start !!");

  // sttProcess.stdin.write("5S0I0R0I:::test");
  sttProcess = spawn(exeFilePath);

  sttProcess.stdout.on("data", (data: any) => {
    const ret = iconv.decode(data, "euc-kr");
    const spltret = ret.split(":::");
    console.log("You said : ", ret);
    console.log("You can say something!!!");
    const config = JSON.parse(fs.readFileSync(iniPath, "utf-8"));
    const irisname = config.settings.irisname;
    console.log("start word : ", irisname);
    if (ret.includes("end")) {
      subWindow.hide();
      subWindow.webContents.send("send-stt", "");
    } else {
      if (ret.includes(irisname) && prevCommand != irisname) {
        subWindow.show();
        subWindow.webContents.send("send-stt", "네, 말씀해주세요.");
        prevCommand = irisname;
        return;
      }
      if (prevCommand === irisname) {
        // subWindow.show();
        subWindow.webContents.send(
          "send-stt",
          ret.slice(ret.lastIndexOf(":") + 1)
        );
        prevCommand = "";
      }
    }
  });

  sttProcess.stderr.on("data", (data: any) => {
    const ret = iconv.decode(data, "euc-kr");
    console.log("appWindow.ts exeSTT error", ret);
  });
}

function killSTT() {
  if (sttProcess && !sttProcess.killed) {
    treeKill(sttProcess.pid);
    console.log("sttProcess has been killed");
  } else {
    console.log("sttProcess is not running or has already been killed");
  }
}

function parseString(inputString: string) {
  const startIndex = inputString.indexOf("{");

  if (startIndex === -1) {
    return null;
  }

  const endIndex = inputString.indexOf("}", startIndex);

  if (endIndex === -1) {
    return null;
  }

  const parsedString = inputString.substring(startIndex, endIndex + 1);

  return parsedString;
}

