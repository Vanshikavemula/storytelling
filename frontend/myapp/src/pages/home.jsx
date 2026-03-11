import { useNavigate } from "react-router-dom"
import { Link } from "react-router-dom";

export default function Home(){

const navigate = useNavigate()

return(

<div>

<div className="navbar">

<h2>Story AI</h2>

<div className="nav-links">
<Link className="nav-link" to="/">Home</Link>
<Link className="nav-link" to="/chatbot">Chatbot</Link>
</div>

</div>

<div className="hero">

<h1>AI Powered Moral Story Assistant</h1>

<p>
Discover meaningful stories based on virtues, values, and characters.
</p>

<div className="annotator-cta">

<h3>Want to be an Annotator?</h3>

<p>Help build the dataset powering the AI.</p>

<button
className="primary-btn"
onClick={() => navigate("/signup?role=annotator")}
>
Signup as Annotator
</button>

</div>

</div>

</div>

)

}