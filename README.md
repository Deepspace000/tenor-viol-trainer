# Goat Viols

A web page for learning to read the C clef (alto clef) on the tenor viol da gamba, and for playing consort music on treble, tenor and bass viols. (It used to be called Tenor Viol Clef Trainer.)

- The look: a medieval page of dark oak, parchment and gilding. Each neck is wood with its own grain and shade, with seven gut frets tied round it (as on a real viol), a bone nut and gut strings.
- The score looks like the printed edition: a white page, Times lettering, each piece's title with the composer under it, C and cut C as printed, bar numbers at the start of each line, and (Notes > Lines as printed) the same lines as the PDF.
- Your score is kept on the device you use: leave the page (another tab, app or site) and come back, or reload it, and the score is as you left it. On an iPad the music stops while you are away, and the first tap back wakes the sound again.
- The notes of the piece: on each neck, every note its part plays in the piece in view (the one playing, the selected note's, or the one at the top of the score) is ringed in the viol's colour and glows, brightest where the part spends most of its time (its tessitura); the other notes step back a little.
- Notes shown (Settings): each note on the neck low and high (every place it can be played), only low (open strings first), or only high on the neck.

Open it here: https://deepspace000.github.io/tenor-viol-trainer/

- One screen: the viol necks at the top, the score underneath scrolling in its own box, and fold-down menus (Practise, Notes, Parts, File, Settings, About). Drag the bar between the necks and the score to give either more room (double-click it to go back). Score size (in Notes) makes the music bigger or smaller.
- The viol neck with every note named. Tap a note to hear it and see it on the staff.
- Treble, tenor and bass viol necks: show any of them (Settings). They sit side by side when there is room. A note tapped on the bass or treble neck is shown on the staff in that viol's clef.
- Quizzes: find a staff note on the neck, name a note on the neck, name a note on the staff.
- Rote (menu): six drills on the tenor (or treble or bass) viol neck, run in a strip under the neck. Find the note: a name is shown (any octave, or with the octave), tap it on the neck. Name the note: a place lights up, press its name from the twelve. Read the staff, find it: a note on the staff in the viol's clef (alto clef for the tenor), tap it on the neck in the right octave. Read the staff, name it. Read a line: six notes on the staff, play them on the neck one after another. Same note, another place: tap a lit note somewhere else on the neck. A round goes on until Finish or for 1, 2 or 5 minutes, and can keep to one string. Each round is kept in a record with its date, time, mark, length and seconds per answer, on this device; a round left unfinished is kept too.
- Practise: open strings, major and minor scales (natural, harmonic, melodic), chromatic scale, arpeggios, scales in thirds, frets 0 to 4 on each string, and string crossing, from any starting note, in one or two octaves, written into the score to play along with.
- Any key signature, and alto, tenor, octave treble, treble or bass clef.
- A score you write by tapping the neck: breve, semibreve, minim, crotchet, quaver and semiquaver, with dots, rests, ties across bar lines, any time signature (4/1, 6/2, 4/2, 3/4 ...) and tempo. Play it back, save it as .json and load it again, or save it as a PDF.
- Note names and movable-do sol-fa under every note. The note that is playing lights up in the score and on the neck.
- Record from a microphone: the notes you play on the viol are written into the score.
- Import MIDI, MusicXML, or printed music as a PDF or picture. Printed music is read on the page itself: notes, rests, rhythms, dots, ties, bar lines, clefs, key and time signatures (also C and cut C), accidentals, repeat signs and first and second endings. The key signature of each piece is worked out from every staff of the piece and checked against the accidentals in the music.
- Full scores: every staff of a system becomes a part (treble, tenor and bass viols, two trebles and a bass, or any other line-up), each in its own clef. Every part has mute, solo, volume, pan and a violin, viola or cello sound, with reverb over all of them. The parts are kept together bar by bar, and play with their repeats and endings. Play from the start, from any piece, repeated section or ending, from any bar, or from a selected note.
- All parts: every part's staff together, bar by bar, with the parts' names; or one part at a time. Click a note or a name to choose the part you work on.
- Neck shows (toolbar): the part whose notes light up on the neck while the music plays, on its viol's neck (or on the tenor neck when that one is hidden). Or "Every part, a neck each": one neck for every part, named after it and tuned like its viol (Viol, per part, under Parts), each lighting up with its part; a tap on a part's neck writes into that part. The playing notes light up big and the other dots dim.
- Each viol has its own colour wherever its parts appear: treble (soprano) yellow, tenor gold, bass purple. The necks are labelled with their name and tuning in that colour, their notes light up in it, the note playing in the score gets a highlighter mark in it, and the parts' names are written in it.
- Follow score: the score keeps the music that is playing in view, and the line that plays moves to the top. Scrolling the score by hand pauses it; press Follow score to go back to the music.

Keys: left and right arrows move from note to note in the score, up and down change the rhythm, 1 to 6 pick a rhythm, `.` adds a dot, R adds a rest, Backspace deletes.

Tenor viol tuning: G2 C3 F3 A3 D4 G4 (a fourth above the bass viol).

Uses [VexFlow](https://github.com/0xfe/vexflow) (MIT) for the staves and [PDF.js](https://github.com/mozilla/pdf.js) (Apache 2.0) to open PDFs.
