import { Game } from './Core/Game.js';

window.addEventListener('DOMContentLoaded', () => {
    const game = new Game();
    
    // Set callback for when game is fully rendered
    game.onFirstRender = () => {
        const loader = document.getElementById('loader');
        if (loader) {
            // STAGE 1: Background + asteroid fade (0.8s)
            // Simultaneously select first unit and fly camera to it
            loader.classList.add('fade-stage-1');
            
            // Auto-select first unit and fly to "full view"
            if (game.units && game.units.length > 0) {
                const firstUnit = game.units[0];
                game.selectAndFlyToUnit(firstUnit);
            }
            
            // STAGE 2: Light beam and text fade (after 1s delay)
            setTimeout(() => {
                loader.classList.add('fade-stage-2');
            }, 1000);
            
            // STAGE 3: Remove from DOM (after total 2s)
            setTimeout(() => {
                loader.classList.add('fade-complete');
            }, 2000);
        }
    };
    
    game.start();
});
