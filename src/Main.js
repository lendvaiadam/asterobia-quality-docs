import { Game } from './Core/Game.js';

window.addEventListener('DOMContentLoaded', () => {
    const game = new Game();
    
    // Set callback for when game is fully rendered
    game.onFirstRender = () => {
        const startScreen = document.getElementById('start-screen');
        const startBtn = document.getElementById('start-btn');
        const loader = document.getElementById('loader');

        // Reveal Start Button
        if (startBtn) {
            startBtn.classList.add('visible');
            
            // Interaction Handler
            startBtn.addEventListener('click', () => {
                // 1. Resume Audio Context (User Gesture)
                if (game.audioManager) {
                    game.audioManager.resumeContext();
                    // 2. Start Space Ambience IMMEDIATELY
                    if (game.audioManager.spaceSound && !game.audioManager.spaceSound.isPlaying) {
                        game.audioManager.spaceSound.setVolume(0.5); // Initial volume override
                        game.audioManager.spaceSound.play();
                    }
                }
                
                // 3. Fade out Start Screen -> Reveals Preloader
                if (startScreen) {
                    startScreen.classList.add('fade-out');
                }
                
                // 4. WAIT 5 SECONDS while Preloader spins
                setTimeout(() => {
                    // 5. Trigger Game Reveal Sequence (Legacy)
                    if (loader) {
                         // STAGE 1: Background + asteroid fade (0.8s)
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
                            // Remove start screen from DOM too
                            if (startScreen) startScreen.remove();
                        }, 2000);
                    }
                }, 5000); // 5 seconds preloader visibility
            });
        }
    };
    
    game.start();
    
    // Global listener fallback (removed - handled by Start Button now)
});
