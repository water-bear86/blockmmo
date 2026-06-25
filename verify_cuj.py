from playwright.sync_api import sync_playwright
import os
import glob

def run_cuj(page):
    page.goto("http://localhost:8080")
    page.wait_for_timeout(1000)

    # 1. Start the game to get into Hearthlight
    page.get_by_placeholder("name the Recorded").fill("TestUser")
    page.wait_for_timeout(500)
    page.get_by_role("button", name="Enter Gracefall").click()
    page.wait_for_timeout(1000)

    # 2. Open Hearthlight (G)
    page.keyboard.press("g")
    page.wait_for_timeout(1000)

    # 3. We are now in Hearthlight where relic buttons live. Take a screenshot.
    page.screenshot(path="/home/jules/verification/screenshots/hearthlight.png")
    page.wait_for_timeout(500)

    # 4. Close Hearthlight
    page.get_by_role("button", name="Leave Hearthlight").click()
    page.wait_for_timeout(500)

    # 5. Open Wardrobe (B)
    page.keyboard.press("b")
    page.wait_for_timeout(1000)

    # 6. We are now in Wardrobe where skin and convert buttons live. Take a screenshot.
    page.screenshot(path="/home/jules/verification/screenshots/wardrobe.png")
    page.wait_for_timeout(1000)

if __name__ == "__main__":
    os.makedirs("/home/jules/verification/videos", exist_ok=True)
    os.makedirs("/home/jules/verification/screenshots", exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            record_video_dir="/home/jules/verification/videos",
            viewport={'width': 1280, 'height': 720}
        )
        page = context.new_page()
        try:
            run_cuj(page)
        except Exception as e:
            print(f"Error: {e}")
        finally:
            context.close()
            browser.close()

    # Find the video file
    videos = glob.glob("/home/jules/verification/videos/*.webm")
    if videos:
        print(f"Video saved to {videos[0]}")
