import fs from 'fs';

var f = fs.readFileSync('H:/obsidian/obsidian/.obsidian/plugins/buddybridge-v1.0.0/main.js', 'utf8');

// Swap: create header FIRST, then list
var oldBlock = 'var tlist = toolsBlock.createDiv({ cls: "buddybridge-tools-list" });\n            tlist.style.display = "none";\n            var thdr = toolsBlock.createDiv({ cls: "buddybridge-tools-header" });';
var newBlock = 'var thdr = toolsBlock.createDiv({ cls: "buddybridge-tools-header" });\n            thdr.style.cursor = "pointer";\n            thdr.textContent = "\\u{1F527} 工具调用 \\u25B8";\n            var tlist = toolsBlock.createDiv({ cls: "buddybridge-tools-list" });\n            tlist.style.display = "none";';

f = f.replace(oldBlock, newBlock);

// Remove the duplicate header setup (cursor, textContent) that was after the old header creation
f = f.replace('            thdr.style.cursor = "pointer";\n            thdr.textContent = "\\u{1F527} 工具调用 \\u25B8";\n            thdr.addEventListener("click"', '            thdr.addEventListener("click"');

fs.writeFileSync('H:/obsidian/obsidian/.obsidian/plugins/buddybridge-v1.0.0/main.js', f);
fs.writeFileSync('H:/Dev/claude/buddybridge/main.js', f);
console.log('done');