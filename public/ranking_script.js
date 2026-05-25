const rankingContainer = document.getElementById('rankingData');

// 🎁 ဆုနာမည်အလိုက် Icon နှင့် အရောင် သတ်မှတ်ပေးသည့် Helper Function
function getPrizeIcon(prizeName) {
    if (!prizeName) return `<i class="fa-solid fa-gift" style="color: #a0aec0;"></i>`;

    const name = prizeName.toLowerCase();

    if (name.includes('diamond')) {
        return `<i class="fa-solid fa-gem" style="color: #00e5ff;"></i>`; // Diamond Icon (အပြာနုရောင်)
    } else if (name.includes('gold')) {
        return `<i class="fa-solid fa-trophy" style="color: #ecc94b;"></i>`; // Gold Trophy
    } else if (name.includes('silver')) {
        return `<i class="fa-solid fa-medal" style="color: #cbd5e1;"></i>`; // Silver Medal
    } else if (name.includes('bronze')) {
        return `<i class="fa-solid fa-award" style="color: #ed8936;"></i>`; // Bronze Award
    } else {
        return `<i class="fa-solid fa-gift" style="color: #ff6b6b;"></i>`; // နှစ်သိမ့်ဆု သို့မဟုတ် အခြားဆုများအတွက် Gift Box
    }
}

async function fetchRankings() {
    try {
        const response = await fetch('http://192.168.21.244:3000/api/ranking');

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const jsonResult = await response.json();
        const rankings = jsonResult.data;

        if (!rankings || rankings.length === 0) {
            rankingContainer.innerHTML = '<tr><td colspan="4" class="no-data">လောလောဆယ်တွင် Ranking စာရင်း မရှိသေးပါ။</td></tr>';
            return;
        }

        rankingContainer.innerHTML = '';

        // fetchRankings() function ထဲက rankings.forEach အကွင်းထဲမှာ ပြင်ရန်
        rankings.forEach((user) => {
            // ဖုန်းနံပါတ် Mask လုပ်ခြင်း
            let formattedPhone = user.userph;
            if (formattedPhone && formattedPhone.length > 5) {
                formattedPhone = formattedPhone.substring(0, 5) + "....";
            } else {
                formattedPhone = "....";
            }

            // ဆုအမျိုးအစားအလိုက် Icon ကို လှမ်းယူခြင်း
            const prizeIcon = getPrizeIcon(user.prizename);

            const tableRow = document.createElement('tr');

            // 💡 ပြင်ဆင်လိုက်သည့်နေရာ: user.sessionid နေရာတွင် user.session_name ကို သုံးထားပါသည်
            tableRow.innerHTML = `
        <td>${user.username}</td>
        <td>${formattedPhone}</td>
        <td style="font-weight: 600;">
            <span style="margin-right: 5px;">${prizeIcon} ${user.prizename || 'မဲနှိုက်ရန်ကျန်'}</span>
        </td>
        <td><span style="background: #e2e8f0; padding: 4px 8px; border-radius: 20px; font-size: 12px;">#${user.session_name || '1'}</span></td>
    `;

            rankingContainer.appendChild(tableRow);
        });

    } catch (error) {
        console.error("❌ Frontend Error:", error);
        rankingContainer.innerHTML = `
            <tr>
                <td colspan="4" class="error">
                    <i class="fa-solid fa-circle-exclamation"></i><br>
                    <small style="color: #ef4444; font-size: 11px;">(${error.message})</small>
                </td>
            </tr>`;
    }
}
// Spin Wheel Logo ကို နှိပ်ရင် Winner Login စာမျက်နှာသို့ ပို့ပေးမည့် Function
function goToWinnerLogin() {
    // လိုအပ်ပါက စာမျက်နှာမကူးခင် အခြားလုပ်ဆောင်ချက်များကို ဒီနေရာမှာ ထည့်ရေးနိုင်ပါတယ်
    
    // winner_login.html သို့ စာမျက်နှာ ရွှေ့ပြောင်းခြင်း
    window.location.href = "winner_login.html";
}

window.onload = fetchRankings;