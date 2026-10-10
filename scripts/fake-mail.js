/* A fake SMTP server for tests: records every message it's sent. */
const net = require("net");
function start(port) {
  const inbox = [];
  const server = net.createServer(sock => {
    let mode = "cmd", data = "", rcpt = [], step = 0;
    sock.write("220 fake ESMTP\r\n");
    sock.on("data", chunk => {
      if (mode === "data") {
        data += chunk.toString();
        if (data.endsWith("\r\n.\r\n")) { inbox.push(parse(data.slice(0, -5), rcpt)); mode = "cmd"; data = ""; rcpt = []; sock.write("250 queued\r\n"); }
        return;
      }
      for (const line of chunk.toString().split("\r\n").filter(Boolean)) {
        if (step === 1) { step = 2; sock.write("334 UGFzc3dvcmQ6\r\n"); continue; }
        if (step === 2) { step = 0; sock.write("235 ok\r\n"); continue; }
        if (/^EHLO/.test(line)) sock.write("250-fake\r\n250 AUTH LOGIN\r\n");
        else if (/^AUTH LOGIN/.test(line)) { step = 1; sock.write("334 VXNlcm5hbWU6\r\n"); }
        else if (/^RCPT TO:<(.+)>/.test(line)) { rcpt.push(line.match(/<(.+)>/)[1]); sock.write("250 ok\r\n"); }
        else if (line === "DATA") { mode = "data"; sock.write("354 go\r\n"); }
        else if (line === "QUIT") { sock.write("221 bye\r\n"); sock.end(); }
        else sock.write("250 ok\r\n");
      }
    });
  });
  function parse(raw, rcpt) {
    const subject = ((raw.match(/^Subject: (.*)$/m) || [])[1] || "").replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (m, b) => Buffer.from(b, "base64").toString());
    const replyTo = ((raw.match(/^Reply-To: (.*)$/m) || [])[1] || "");
    const parts = [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g)].map(m => Buffer.from(m[1].replace(/\r\n/g, ""), "base64").toString());
    return { to: rcpt, subject, replyTo, text: parts[0] || "", html: parts[1] || "", raw };
  }
  return new Promise(r => server.listen(port, "127.0.0.1", () => r({
    inbox, close: () => server.close(),
    to: (addr, re) => inbox.filter(m => m.to.includes(addr) && (!re || re.test(m.subject))),
  })));
}
module.exports = { start };
