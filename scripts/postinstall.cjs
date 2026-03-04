/**
 * Flow2Code — postinstall message
 * Shows a friendly star request when users install the package.
 */

const message = `
  ╔══════════════════════════════════════════════════╗
  ║                                                  ║
  ║   🎉  Thank you for installing Flow2Code!        ║
  ║                                                  ║
  ║   Visual AST Compiler for Backend APIs           ║
  ║   Flow → TypeScript · TypeScript → Flow          ║
  ║                                                  ║
  ║   ⭐  If you find it useful, star us on GitHub:  ║
  ║   → https://github.com/timo9378/flow2code        ║
  ║                                                  ║
  ║   📖  Docs: npx flow2code --help                 ║
  ║   🚀  Quick start: npx flow2code init            ║
  ║                                                  ║
  ╚══════════════════════════════════════════════════╝
`;

console.log(message);
